/**
 * Panoptica365 — SharePoint Graph helpers
 * Ported from Tabula Accessus lib/graph.js — adapted to use Panoptica's
 * auth.acquireTokenForTenant (single multi-tenant app, admin consent).
 *
 * All calls go through Microsoft Graph v1.0. No SharePoint REST.
 */

const auth = require('../auth');

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

// ─── Low-level request with retry on 429/503/504 ─────────────────────────────

async function spRequest(tenantGuid, endpoint, options = {}) {
  const token = await auth.acquireTokenForTenant(tenantGuid);
  const url = endpoint.startsWith('http') ? endpoint : `${GRAPH_BASE}${endpoint}`;

  const response = await fetchWithRetry(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ConsistencyLevel: 'eventual',
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    const err = new Error(`Graph ${response.status}: ${errorBody.substring(0, 300)}`);
    err.statusCode = response.status;
    throw err;
  }

  const data = await response.json();

  if (options.allPages && data['@odata.nextLink']) {
    const next = await spRequest(tenantGuid, data['@odata.nextLink'], options);
    data.value = [...(data.value || []), ...(next.value || [])];
  }
  return data;
}

async function fetchWithRetry(url, opts, maxRetries = 5) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, opts);
    if (res.status === 429 || res.status === 503 || res.status === 504) {
      const retryAfter = res.headers.get('Retry-After');
      const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : Math.min(1000 * Math.pow(2, attempt), 30000);
      console.log(`[SP] Throttled (${res.status}). Retry ${attempt + 1}/${maxRetries} in ${waitMs}ms`);
      await new Promise(r => setTimeout(r, waitMs));
      continue;
    }
    return res;
  }
  throw new Error(`SP Graph request failed after ${maxRetries} retries: ${url}`);
}

// ─── Permissions preflight ───────────────────────────────────────────────────
// Verifies the tenant's Graph app has Sites.Read.All + Directory.Read.All at least.

async function preflight(tenantGuid) {
  const results = { sites: false, directory: false, sitesFull: false, errors: [] };
  try {
    await spRequest(tenantGuid, '/sites?search=*&$top=1');
    results.sites = true;
  } catch (e) {
    results.errors.push(`sites: ${e.statusCode || ''} ${e.message.substring(0, 140)}`);
  }
  try {
    await spRequest(tenantGuid, '/users?$top=1&$select=id');
    results.directory = true;
  } catch (e) {
    results.errors.push(`users: ${e.statusCode || ''} ${e.message.substring(0, 140)}`);
  }
  // We can't directly probe Sites.FullControl.All; if listing works but reading
  // permissions fails later the caller will see it. Mark best-guess based on sites.
  results.sitesFull = results.sites;
  results.ok = results.sites && results.directory;
  return results;
}

// ─── Inventory ──────────────────────────────────────────────────────────────

async function listSites(tenantGuid) {
  const data = await spRequest(
    tenantGuid,
    '/sites?search=*&$top=100&$select=id,displayName,name,webUrl,createdDateTime,lastModifiedDateTime,isPersonalSite',
    { allPages: true }
  );
  return (data.value || [])
    .filter(s => !s.isPersonalSite && !(s.name === '' && !s.displayName))
    .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
}

async function listDrives(tenantGuid, siteId) {
  const data = await spRequest(
    tenantGuid,
    `/sites/${siteId}/drives?$select=id,name,driveType,webUrl,createdDateTime,lastModifiedDateTime,quota`,
    { allPages: true }
  );
  return (data.value || [])
    .filter(d => d.driveType === 'documentLibrary')
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

async function getInventory(tenantGuid) {
  const sites = await listSites(tenantGuid);
  const inventory = [];
  const BATCH = 5;
  for (let i = 0; i < sites.length; i += BATCH) {
    const batch = sites.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async site => {
        try {
          const drives = await listDrives(tenantGuid, site.id);
          return { ...site, drives, driveCount: drives.length, error: null };
        } catch (err) {
          return { ...site, drives: [], driveCount: 0, error: err.message };
        }
      })
    );
    inventory.push(...results);
  }
  return inventory;
}

// ─── Audit (folder crawl + permissions) ─────────────────────────────────────

async function getDriveRoot(tenantGuid, driveId) {
  return spRequest(tenantGuid, `/drives/${driveId}/root?$select=id,webUrl,name`);
}

async function crawlFolders(tenantGuid, driveId, folderId = 'root', parentPath = '', depth = 0, progressCb = null, maxDepth = 15) {
  if (depth >= maxDepth) return [];
  const endpoint =
    folderId === 'root'
      ? `/drives/${driveId}/root/children?$select=id,name,folder,webUrl,parentReference&$top=200`
      : `/drives/${driveId}/items/${folderId}/children?$select=id,name,folder,webUrl,parentReference&$top=200`;

  let items;
  try {
    const data = await spRequest(tenantGuid, endpoint, { allPages: true });
    items = data.value || [];
  } catch (err) {
    console.log(`[SP] Could not list children of ${folderId}: ${err.message.substring(0, 120)}`);
    return [];
  }

  const folders = items.filter(it => it.folder);
  const entries = folders.map(f => ({
    id: f.id,
    name: f.name,
    webUrl: f.webUrl || '',
    path: parentPath ? `${parentPath}/${f.name}` : f.name,
    depth: depth + 1,
  }));

  if (progressCb && entries.length > 0) progressCb(entries.length);

  const CONCURRENCY = 5;
  const allNested = [];
  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const batch = entries.slice(i, i + CONCURRENCY);
    const res = await Promise.all(
      batch.map(f => crawlFolders(tenantGuid, driveId, f.id, f.path, depth + 1, progressCb, maxDepth))
    );
    allNested.push(...res.flat());
  }
  return [...entries, ...allNested];
}

async function getItemPermissions(tenantGuid, driveId, itemId) {
  try {
    // NOTE: no $select. Graph's $select is a whitelist — if we omit a field
    // (e.g. grantedToIdentitiesV2), it gets stripped from the response and
    // our sharing-link recipient enumeration silently returns zero people.
    // The permission object is small enough that full responses are fine.
    const data = await spRequest(
      tenantGuid,
      `/drives/${driveId}/items/${itemId}/permissions`
    );
    const perms = data.value || [];
    const uniquePerms = perms.filter(p => !p.inheritedFrom);
    return {
      allPermissions: perms,
      uniquePermissions: uniquePerms,
      hasUniquePermissions: uniquePerms.length > 0,
      totalCount: perms.length,
    };
  } catch (err) {
    console.log(`[SP] Permission read error ${itemId}: ${err.message.substring(0, 120)}`);
    return { allPermissions: [], uniquePermissions: [], hasUniquePermissions: false, totalCount: 0 };
  }
}

/**
 * Normalize Graph permission objects to our standard rows.
 * Emits ONE row per direct grantee; additionally expands
 * `grantedToIdentitiesV2` (sharing links shared with specific people)
 * into individual rows per identity, flagging externals based on
 * verifiedDomains (a Set of lowercased domain strings).
 */
function normalizePermissions(permissions, verifiedDomains = null) {
  const mapRole = r => {
    switch (r) {
      case 'owner': return 'Full Control';
      case 'write': return 'Edit';
      case 'read':  return 'Read';
      default:      return r;
    }
  };
  const isExternal = email => {
    if (!verifiedDomains || !email) return false;
    const at = email.lastIndexOf('@');
    if (at === -1) return false;
    const dom = email.substring(at + 1).toLowerCase();
    return !verifiedDomains.has(dom);
  };

  const out = [];
  for (const p of permissions) {
    const roles = (p.roles || []).map(mapRole);
    if (roles.length === 0) continue;

    const granted = p.grantedToV2 || p.grantedTo;
    let primary = null;

    if (granted && granted.user) {
      const email = granted.user.email || granted.user.loginName || '';
      primary = {
        principalId: granted.user.id || '',
        principalType: isExternal(email) ? 'User (external)' : 'User',
        principalName: granted.user.displayName || email || '(unknown user)',
        loginName: email,
        principalEmail: email || undefined,
        roles,
      };
    } else if (granted && granted.group) {
      primary = {
        principalId: granted.group.id || '',
        principalType: 'SecurityGroup',
        principalName: granted.group.displayName || '(unknown group)',
        loginName: granted.group.id || '',
        roles,
      };
    } else if (granted && granted.siteGroup) {
      primary = {
        principalId: granted.siteGroup.id || '',
        principalType: 'SharePointGroup',
        principalName: granted.siteGroup.displayName || '(unknown SP group)',
        loginName: granted.siteGroup.loginName || '',
        roles,
      };
    }

    if (primary) {
      out.push(primary);
      continue;
    }

    // No direct grantee — handle sharing links
    if (p.link) {
      const linkType = p.link.type || 'unknown';
      const linkScope = p.link.scope ? ` / ${p.link.scope}` : '';
      const linkLabel = `Sharing Link (${linkType}${linkScope})`;
      // Prefer V2 (current), fall back to deprecated grantedToIdentities
      const identities = Array.isArray(p.grantedToIdentitiesV2) && p.grantedToIdentitiesV2.length
        ? p.grantedToIdentitiesV2
        : (Array.isArray(p.grantedToIdentities) ? p.grantedToIdentities : []);

      if (identities.length === 0) {
        // Link with no specific recipients (anonymous, company-wide, etc.)
        out.push({
          principalId: '',
          principalType: 'Link',
          principalName: linkLabel,
          loginName: '',
          roles,
        });
        continue;
      }

      // ONE ROW PER RECIPIENT. Each person the link was shared with gets
      // their own entry so User Permissions aggregation counts them.
      for (const ident of identities) {
        // Try identity types in order of preference. Graph's identitySet
        // can populate any of: user, siteUser, application, group, device.
        const u =
          ident.user ||
          ident.siteUser ||
          ident.application ||
          ident.group ||
          {};
        const email = u.email || u.loginName || u.userPrincipalName || '';
        const rawName = u.displayName || email;

        // Determine the correct type
        let principalType;
        if (ident.siteUser)       principalType = 'Site User';
        else if (ident.application) principalType = 'Application';
        else if (ident.group)     principalType = 'Group';
        else                      principalType = isExternal(email) ? 'User (external)' : 'User';

        // If we STILL can't put a name on it, emit a descriptive label
        // instead of anonymous "(unknown)" so they don't all collapse
        // into one bucket during user-permissions aggregation.
        let name = rawName;
        if (!name) {
          // One-time diagnostic log — dump the raw identity shape so we
          // can see what Graph actually returned for unresolvable cases.
          if (!normalizePermissions._loggedUnknown) {
            normalizePermissions._loggedUnknown = true;
            try {
              console.log('[SP] Unidentified link recipient shape:', JSON.stringify(ident).substring(0, 300));
            } catch (_e) { /* ignore */ }
          }
          // Key by id to keep them distinct in aggregation
          const stub = u.id ? u.id.substring(0, 12) : `link:${linkType}`;
          name = `Link recipient (${stub})`;
          principalType = 'Link recipient (unresolved)';
        }

        out.push({
          principalId: u.id || '',
          principalType,
          principalName: name,
          loginName: email,
          principalEmail: email || undefined,
          sharedVia: linkLabel,   // traceability back to the link
          roles,
        });
      }
    }
  }
  return out;
}

// ─── Group/user resolution with cache ───────────────────────────────────────

const principalCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cacheGet(k) {
  const e = principalCache.get(k);
  if (e && Date.now() - e.ts < CACHE_TTL_MS) return e.data;
  principalCache.delete(k);
  return null;
}
function cacheSet(k, v) { principalCache.set(k, { data: v, ts: Date.now() }); }

const nonGuidLogged = new Set();  // log each non-GUID group only once

async function getGroupMembers(tenantGuid, groupId, maxDepth = 5, visited = new Set()) {
  if (visited.has(groupId)) return [];
  visited.add(groupId);
  const cacheKey = `group:${tenantGuid}:${groupId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  if (!GUID_RE.test(groupId)) {
    if (!nonGuidLogged.has(groupId)) {
      nonGuidLogged.add(groupId);
      console.log(`[SP] Skipping non-GUID group (SharePoint built-in): ${groupId}`);
    }
    return [];
  }

  try {
    const data = await spRequest(
      tenantGuid,
      `/groups/${groupId}/members?$select=id,displayName,mail,userPrincipalName&$top=999`,
      { allPages: true }
    );
    const members = [];
    for (const m of data.value || []) {
      const t = m['@odata.type'] || '';
      if (t.includes('user')) {
        members.push({
          displayName: m.displayName || '(unknown)',
          email: m.mail || m.userPrincipalName || '',
          type: 'User',
        });
      } else if (t.includes('group') && maxDepth > 1) {
        const nested = await getGroupMembers(tenantGuid, m.id, maxDepth - 1, visited);
        members.push(...nested);
      }
    }
    cacheSet(cacheKey, members);
    return members;
  } catch (err) {
    console.log(`[SP] Group resolve failed ${groupId}: ${err.message.substring(0, 100)}`);
    return [];
  }
}

async function resolveUser(tenantGuid, loginName) {
  const cacheKey = `user:${tenantGuid}:${loginName}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  let upn = loginName;
  const pipe = loginName.lastIndexOf('|');
  if (pipe !== -1) upn = loginName.substring(pipe + 1);
  try {
    const data = await spRequest(tenantGuid, `/users/${encodeURIComponent(upn)}?$select=displayName,mail,userPrincipalName`);
    const r = {
      displayName: data.displayName || upn,
      email: data.mail || data.userPrincipalName || upn,
    };
    cacheSet(cacheKey, r);
    return r;
  } catch {
    const fb = { displayName: upn, email: upn };
    cacheSet(cacheKey, fb);
    return fb;
  }
}

function extractGroupId(loginName) {
  if (!loginName) return null;
  const fed = loginName.match(/federateddirectoryclaimprovider\|([0-9a-f-]{36})/i);
  if (fed) return fed[1];
  const t = loginName.match(/tenant\|([0-9a-f-]{36})/i);
  if (t) return t[1];
  if (/^[0-9a-f-]{36}$/i.test(loginName)) return loginName;
  return null;
}

async function resolvePermissionMembers(tenantGuid, assignments) {
  const MAX = 5;
  const out = [];
  for (let i = 0; i < assignments.length; i += MAX) {
    const batch = assignments.slice(i, i + MAX);
    const res = await Promise.all(
      batch.map(async a => {
        const r = { ...a, members: [] };
        if (a.principalType === 'SecurityGroup' || a.principalType === 'SharePointGroup' || a.principalType === 'DL') {
          const gid = extractGroupId(a.loginName) || a.principalId;
          if (gid) {
            try { r.members = await getGroupMembers(tenantGuid, gid); } catch (_e) { /* ignore */ }
          }
        } else if (a.principalType === 'User' && a.loginName) {
          try {
            const u = await resolveUser(tenantGuid, a.loginName);
            r.principalEmail = u.email;
            if (u.displayName && u.displayName !== a.principalName) r.principalName = u.displayName;
          } catch (_e) { /* keep as-is */ }
        }
        return r;
      })
    );
    out.push(...res);
  }
  return out;
}

// ─── Library size (from drive quota) ────────────────────────────────────────

/**
 * Fetch the tenant's verified domains. Returns a Set of lowercased domains.
 * Used to classify external users by email domain.
 */
async function getVerifiedDomains(tenantGuid) {
  try {
    const data = await spRequest(tenantGuid, '/organization?$select=verifiedDomains');
    const org = (data.value || [])[0];
    const domains = (org?.verifiedDomains || []).map(d => (d.name || '').toLowerCase()).filter(Boolean);
    return new Set(domains);
  } catch (err) {
    console.log(`[SP] Could not fetch verified domains: ${err.message.substring(0, 100)}`);
    return new Set();
  }
}

async function getDriveQuota(tenantGuid, driveId) {
  try {
    const d = await spRequest(tenantGuid, `/drives/${driveId}?$select=quota`);
    return d.quota && d.quota.used ? d.quota.used : 0;
  } catch {
    return 0;
  }
}

module.exports = {
  spRequest,
  preflight,
  listSites,
  listDrives,
  getInventory,
  getDriveRoot,
  crawlFolders,
  getItemPermissions,
  normalizePermissions,
  resolvePermissionMembers,
  getDriveQuota,
  getVerifiedDomains,
};
