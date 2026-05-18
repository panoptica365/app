/**
 * Panoptica — Graph API Data Fetchers (Phase 2 Rewrite)
 * Based on Praesidium Analytica scan modules, adapted for continuous polling.
 *
 * Two tiers:
 *   LIVE  — runs every poll cycle (usage reports, secure score, devices, licensing counts)
 *   SLOW  — runs every Nth poll (conditional access, domains/DNS, mail forwarding, inactive users, apps)
 *
 * Required Graph API permissions:
 *   User.Read.All, Group.Read.All, Device.Read.All, Directory.Read.All,
 *   Reports.Read.All, SecurityEvents.Read.All, UserAuthenticationMethod.Read.All,
 *   IdentityRiskyUser.Read.All, Policy.Read.All, MailboxSettings.Read,
 *   Organization.Read.All, Application.Read.All, Sites.Read.All,
 *   DeviceManagementManagedDevices.Read.All, Domain.Read.All
 */

const graph = require('./graph');
const https = require('https');
const crypto = require('crypto');
const { runExoCmdlet } = require('./lib/security-settings/pwsh-runner');

/**
 * Stable JSON stringify: recursively sorts object keys so two objects with the
 * same content but different key order serialize identically. Used to hash
 * inbox-rule action blobs for modification detection.
 */
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

function hashActions(actions) {
  // Short hash is fine — collisions would need both rule content AND dedup_key
  // collision to cause a missed alert, and dedup_key includes the hash already.
  return crypto.createHash('sha256').update(stableStringify(actions || {})).digest('hex').slice(0, 16);
}

// ─── Helpers ───

function reportUrl(endpoint) {
  const sep = endpoint.includes('?') ? '&' : '?';
  return endpoint + sep + '$format=application/json';
}

const REPORT_OPTS = { version: 'beta' };

/**
 * Case-insensitive / flexible property getter.
 * Handles CSV headers with spaces ("Report Date" → matches "reportDate").
 */
function rpt(obj, key) {
  if (obj[key] !== undefined) return obj[key];
  const lower = key.toLowerCase();
  const stripped = lower.replace(/[\s_-]/g, '');
  for (const k of Object.keys(obj)) {
    const kLower = k.toLowerCase();
    if (kLower === lower) return obj[k];
    if (kLower.replace(/[\s_-]/g, '') === stripped) return obj[k];
  }
  return undefined;
}

function parseReport(report) {
  if (Array.isArray(report?.value)) return report.value;
  if (Array.isArray(report)) return report;
  if (report?._csv && typeof report._csv === 'string') return parseCsv(report._csv);
  return [];
}

function parseCsv(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].replace(/^\uFEFF/, '').split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    if (vals.length !== headers.length) continue;
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = vals[idx]; });
    rows.push(obj);
  }
  return rows;
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ─── SKU Friendly Names (from PA) ───

const SKU_FRIENDLY_NAMES = {
  'O365_BUSINESS_ESSENTIALS': 'Microsoft 365 Business Basic',
  'O365_BUSINESS_PREMIUM': 'Microsoft 365 Business Standard',
  'SPB': 'Microsoft 365 Business Premium',
  'O365_BUSINESS': 'Microsoft 365 Apps for Business',
  'STANDARDPACK': 'Office 365 E1',
  'ENTERPRISEPACK': 'Office 365 E3',
  'ENTERPRISEPREMIUM': 'Office 365 E5',
  'ENTERPRISEPREMIUM_NOPSTNCONF': 'Office 365 E5 (w/o Audio Conf)',
  'SPE_E3': 'Microsoft 365 E3',
  'SPE_E5': 'Microsoft 365 E5',
  'SPE_F1': 'Microsoft 365 F3',
  'DESKLESSPACK': 'Office 365 F3',
  'M365_F1': 'Microsoft 365 F1',
  'EXCHANGESTANDARD': 'Exchange Online Plan 1',
  'EXCHANGEENTERPRISE': 'Exchange Online Plan 2',
  'EXCHANGE_S_ESSENTIALS': 'Exchange Online Essentials',
  'EXCHANGEARCHIVE_ADDON': 'Exchange Online Archiving',
  'EXCHANGEESSENTIALS': 'Exchange Online Essentials',
  'EXCHANGEDESKLESS': 'Exchange Online Kiosk',
  'EOP_ENTERPRISE': 'Exchange Online Protection',
  'SHAREPOINTSTANDARD': 'SharePoint Online Plan 1',
  'SHAREPOINTENTERPRISE': 'SharePoint Online Plan 2',
  'WACONEDRIVESTANDARD': 'OneDrive for Business Plan 1',
  'WACONEDRIVEENTERPRISE': 'OneDrive for Business Plan 2',
  'AAD_PREMIUM': 'Azure AD Premium P1',
  'AAD_PREMIUM_P2': 'Azure AD Premium P2',
  'IDENTITY_THREAT_PROTECTION': 'Microsoft 365 E5 Security',
  'ATP_ENTERPRISE': 'Defender for Office 365 P1',
  'THREAT_INTELLIGENCE': 'Defender for Office 365 P2',
  'ATA': 'Defender for Identity',
  'MDATP_XPLAT': 'Defender for Endpoint P2',
  'WIN_DEF_ATP': 'Defender for Endpoint P1',
  'INFORMATION_PROTECTION_COMPLIANCE': 'M365 E5 Compliance',
  'EMSPREMIUM': 'EMS E5',
  'EMS': 'EMS E3',
  'INTUNE_A': 'Intune Plan 1',
  'INTUNE_A_D': 'Intune Device',
  'FLOW_FREE': 'Power Automate Free',
  'POWER_BI_STANDARD': 'Microsoft Fabric (Free)',
  'POWER_BI_PRO': 'Power BI Pro',
  'TEAMS_EXPLORATORY': 'Teams Exploratory',
  'TEAMS_FREE': 'Teams (Free)',
  'MEETING_ROOM': 'Teams Rooms Standard',
  'VISIOCLIENT': 'Visio Plan 2',
  'PROJECTPREMIUM': 'Project Plan 5',
  'PROJECTPROFESSIONAL': 'Project Plan 3',
  'WIN10_PRO_ENT_SUB': 'Windows 10/11 Enterprise E3',
  'WIN10_VDA_E5': 'Windows 10/11 Enterprise E5',
  'DEVELOPERPACK_E5': 'Microsoft 365 E5 Developer',
};

function skuName(partNumber) {
  return SKU_FRIENDLY_NAMES[partNumber] || partNumber;
}

// ─── DNS-over-HTTPS (from PA) ───

function dohQuery(name, type, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const url = `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`;
    const timer = setTimeout(() => { req.destroy(); reject({ code: 'ETIMEOUT', message: `DoH timeout ${type} ${name}` }); }, timeoutMs);
    const req = https.get(url, { headers: { Accept: 'application/dns-json' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        clearTimeout(timer);
        try {
          const json = JSON.parse(data);
          resolve(json.Status === 3 || !json.Answer || json.Answer.length === 0 ? [] : json.Answer);
        } catch (e) { reject({ code: 'EPARSE', message: e.message }); }
      });
    });
    req.on('error', (err) => { clearTimeout(timer); reject({ code: err.code || 'ENETWORK', message: err.message }); });
  });
}

// ═══════════════════════════════════════════
// LIVE-TIER FETCHERS (every poll)
// ═══════════════════════════════════════════

// ─── Secure Score ───
async function fetchSecureScore(tenantId) {
  return { secure_score: await graph.getSecureScore(tenantId) };
}

// ─── Licensing ───
async function fetchLicensing(tenantId) {
  const data = {};

  const skus = await graph.callGraphPaged(tenantId, '/subscribedSkus?$select=skuPartNumber,skuId,capabilityStatus,consumedUnits,prepaidUnits');

  // Build license list with friendly names
  const skuMap = {};
  const licenses = (skus || []).map(sku => {
    const name = skuName(sku.skuPartNumber);
    skuMap[sku.skuId] = name;
    return {
      skuId: sku.skuId,
      skuPartNumber: sku.skuPartNumber,
      displayName: name,
      total: sku.prepaidUnits?.enabled || 0,
      assigned: sku.consumedUnits || 0,
      available: (sku.prepaidUnits?.enabled || 0) - (sku.consumedUnits || 0),
      status: sku.capabilityStatus,
    };
  });

  // Get users with license info
  let users;
  try {
    users = await graph.callGraphPaged(tenantId, '/users?$select=id,displayName,userPrincipalName,assignedLicenses,accountEnabled,userType,signInActivity&$top=999');
  } catch (e) {
    users = await graph.callGraphPaged(tenantId, '/users?$select=id,displayName,userPrincipalName,assignedLicenses,accountEnabled,userType&$top=999');
  }

  const isGuest = (u) => u.userType === 'Guest' || (u.userPrincipalName || '').includes('#EXT#');
  let guestCount = 0;
  const unlicensedUsers = [];

  // Build per-user license mapping
  const licensedUserMap = {};
  for (const user of users) {
    const guest = isGuest(user);
    if (guest) guestCount++;

    if (user.assignedLicenses && user.assignedLicenses.length > 0) {
      for (const al of user.assignedLicenses) {
        const licName = skuMap[al.skuId] || al.skuId;
        if (!licensedUserMap[user.userPrincipalName]) {
          licensedUserMap[user.userPrincipalName] = {
            displayName: user.displayName,
            userPrincipalName: user.userPrincipalName,
            enabled: user.accountEnabled,
            licenses: []
          };
        }
        licensedUserMap[user.userPrincipalName].licenses.push(licName);
      }
    } else if (!guest) {
      unlicensedUsers.push({
        displayName: user.displayName,
        userPrincipalName: user.userPrincipalName,
        enabled: user.accountEnabled,
      });
    }
  }

  const licensedUsers = Object.values(licensedUserMap).map(u => ({
    ...u, licenses: u.licenses.join(', ')
  })).sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));

  data.licenses = licenses;
  data.licensedUsers = licensedUsers;
  data.unlicensedUsers = unlicensedUsers;
  data.user_summary = {
    total: users.length,
    members: users.length - guestCount,
    guests: guestCount,
    licensed: licensedUsers.length,
    unlicensed: unlicensedUsers.length,
  };

  return data;
}

// ─── Devices (Entra + Intune) ───
async function fetchDevices(tenantId) {
  const data = {};

  // Entra devices
  try {
    const devices = await graph.callGraphPaged(tenantId, '/devices?$select=id,displayName,operatingSystem,operatingSystemVersion,isManaged,isCompliant,trustType,accountEnabled,approximateLastSignInDateTime,registrationDateTime&$top=999');
    const allDevices = devices || [];
    const complianceApplicable = allDevices.filter(d => d.isCompliant === true || d.isCompliant === false);
    const compliant = allDevices.filter(d => d.isCompliant === true);
    const managementApplicable = allDevices.filter(d => d.isManaged === true || d.isManaged === false);
    const managed = allDevices.filter(d => d.isManaged === true);
    const osCounts = {};
    allDevices.forEach(d => { const os = d.operatingSystem || 'Unknown'; osCounts[os] = (osCounts[os] || 0) + 1; });

    data.device_counts = {
      total: allDevices.length,
      managed: managed.length,
      managed_applicable: managementApplicable.length,
      compliant: compliant.length,
      compliant_applicable: complianceApplicable.length,
      by_os: osCounts,
    };
    data.device_list = allDevices.map(d => ({
      displayName: d.displayName,
      os: d.operatingSystem,
      osVersion: d.operatingSystemVersion,
      trustType: d.trustType,
      isManaged: d.isManaged,
      isCompliant: d.isCompliant,
      enabled: d.accountEnabled,
      lastSignIn: d.approximateLastSignInDateTime,
      registered: d.registrationDateTime,
    }));
  } catch (e) {
    console.warn(`[Fetcher] Entra devices failed for ${tenantId}:`, e.message);
    data.device_counts = { total: 0, managed: 0, compliant: 0, by_os: {} };
    data.device_list = [];
  }

  // Intune managed devices
  try {
    const intuneDevices = await graph.callGraphPaged(tenantId,
      '/deviceManagement/managedDevices?$select=deviceName,operatingSystem,osVersion,complianceState,managementAgent,enrolledDateTime,lastSyncDateTime,userDisplayName,userPrincipalName,model,manufacturer&$top=999');
    data.intune_devices = (intuneDevices || []).map(d => ({
      deviceName: d.deviceName,
      os: d.operatingSystem,
      osVersion: d.osVersion,
      complianceState: d.complianceState,
      managementAgent: d.managementAgent,
      enrolled: d.enrolledDateTime,
      lastSync: d.lastSyncDateTime,
      user: d.userDisplayName,
      userPrincipal: d.userPrincipalName,
      model: d.model,
      manufacturer: d.manufacturer,
    }));
  } catch (e) {
    if (e.statusCode === 403) {
      console.log(`[Fetcher] Intune devices skipped for ${tenantId} (no license/permission)`);
    } else {
      console.warn(`[Fetcher] Intune devices failed for ${tenantId}:`, e.message);
    }
    data.intune_devices = [];
  }

  return data;
}

// ─── SharePoint Usage (two-source merge from PA) ───
async function fetchSharePointUsage(tenantId) {
  const data = {};

  try {
    // Step 1: Get all sites from /sites API for display names
    const allSites = await graph.callGraphPaged(tenantId, '/sites?search=*&$select=id,displayName,webUrl&$top=999');
    const siteNameLookup = {};
    for (const site of (allSites || [])) {
      if (site.id) {
        const parts = site.id.split(',');
        const siteGuid = parts.length >= 2 ? parts[1].trim().toLowerCase() : site.id.toLowerCase();
        siteNameLookup[siteGuid] = { displayName: site.displayName || '', webUrl: site.webUrl || '' };
      }
    }

    // Step 2: Get usage report for metrics
    const report = await graph.callGraph(tenantId,
      reportUrl("/reports/getSharePointSiteUsageDetail(period='D7')"),
      REPORT_OPTS
    );
    const siteRows = parseReport(report);

    // Step 3: Merge — for each report entry, resolve display name
    const sharePointSites = [];
    const anonymousLinkData = [];

    for (const site of siteRows) {
      if (rpt(site, 'isDeleted') === 'True' || rpt(site, 'isDeleted') === true) continue;

      const siteUrl = rpt(site, 'siteUrl') || rpt(site, 'siteURL') || '';
      const siteId = (rpt(site, 'siteId') || '').toLowerCase();
      const ownerName = rpt(site, 'ownerDisplayName') || '';
      const isPersonal = siteUrl.includes('-my.sharepoint.com/personal/') ||
        (rpt(site, 'rootWebTemplate') || '').toLowerCase() === 'personal' ||
        rpt(site, 'siteType') === 'Personal';

      if (isPersonal) continue; // OneDrive handled separately

      const lookup = siteId ? siteNameLookup[siteId] : null;
      const siteName = (lookup && lookup.displayName) || ownerName || 'Unknown Site';
      const resolvedUrl = (lookup && lookup.webUrl) || siteUrl;

      const storageUsedBytes = parseInt(rpt(site, 'storageUsedInBytes') || rpt(site, 'Storage Used (Byte)') || '0', 10);
      const fileCount = parseInt(rpt(site, 'fileCount') || rpt(site, 'File Count') || '0', 10);
      const anonymousLinkCount = parseInt(rpt(site, 'anonymousLinkCount') || rpt(site, 'Anonymous Link Count') || '0', 10);
      const companyLinkCount = parseInt(rpt(site, 'companyLinkCount') || rpt(site, 'Company Link Count') || '0', 10);

      sharePointSites.push({
        siteId,
        siteUrl: resolvedUrl,
        siteName,
        ownerDisplayName: ownerName,
        storageUsedBytes,
        storageAllocatedBytes: parseInt(rpt(site, 'storageAllocatedInBytes') || rpt(site, 'Storage Allocated (Byte)') || '0', 10),
        fileCount,
        activeFileCount: parseInt(rpt(site, 'activeFileCount') || rpt(site, 'Active File Count') || '0', 10),
        pageViewCount: parseInt(rpt(site, 'pageViewCount') || rpt(site, 'Page View Count') || '0', 10),
        lastActivityDate: rpt(site, 'lastActivityDate') || rpt(site, 'Last Activity Date') || '',
        anonymousLinkCount,
        companyLinkCount,
        rootWebTemplate: rpt(site, 'rootWebTemplate') || rpt(site, 'Root Web Template') || '',
      });

      if (anonymousLinkCount > 0) {
        anonymousLinkData.push({ siteName, ownerDisplayName: ownerName, anonymousLinkCount, companyLinkCount });
      }
    }

    sharePointSites.sort((a, b) => b.storageUsedBytes - a.storageUsedBytes);

    const totalAnonymousLinks = sharePointSites.reduce((sum, s) => sum + (s.anonymousLinkCount || 0), 0);
    const totalCompanyLinks = sharePointSites.reduce((sum, s) => sum + (s.companyLinkCount || 0), 0);
    const totalStorageUsedBytes = sharePointSites.reduce((sum, s) => sum + (s.storageUsedBytes || 0), 0);
    const totalFileCount = sharePointSites.reduce((sum, s) => sum + (s.fileCount || 0), 0);

    data.sharepoint_sites = sharePointSites;
    data.anonymous_links = anonymousLinkData;
    data.sharepoint_counts = {
      total_sites: sharePointSites.length,
      total_files: totalFileCount,
      total_storage_bytes: totalStorageUsedBytes,
      total_storage_gb: parseFloat((totalStorageUsedBytes / (1024 * 1024 * 1024)).toFixed(2)),
      total_anonymous_links: totalAnonymousLinks,
      total_company_links: totalCompanyLinks,
      sites_with_anonymous_links: anonymousLinkData.length,
    };
  } catch (e) {
    console.warn(`[Fetcher] SharePoint usage failed for ${tenantId}:`, e.message);
    data.sharepoint_sites = [];
    data.anonymous_links = [];
    data.sharepoint_counts = { total_sites: 0, total_files: 0, total_storage_bytes: 0, total_storage_gb: 0, total_anonymous_links: 0, total_company_links: 0, sites_with_anonymous_links: 0 };
  }

  return data;
}

// ─── OneDrive Usage ───
async function fetchOneDriveUsage(tenantId) {
  const data = {};

  try {
    const report = await graph.callGraph(tenantId,
      reportUrl("/reports/getOneDriveUsageAccountDetail(period='D7')"),
      REPORT_OPTS
    );
    const odRows = parseReport(report);

    const oneDriveSites = [];
    for (const acct of odRows) {
      if (rpt(acct, 'isDeleted') === 'True' || rpt(acct, 'isDeleted') === true) continue;
      oneDriveSites.push({
        siteName: rpt(acct, 'ownerDisplayName') || rpt(acct, 'ownerPrincipalName') || 'Unknown',
        ownerPrincipalName: rpt(acct, 'ownerPrincipalName') || '',
        storageUsedBytes: parseInt(rpt(acct, 'storageUsedInBytes') || rpt(acct, 'Storage Used (Byte)') || '0', 10),
        storageAllocatedBytes: parseInt(rpt(acct, 'storageAllocatedInBytes') || rpt(acct, 'Storage Allocated (Byte)') || '0', 10),
        fileCount: parseInt(rpt(acct, 'fileCount') || rpt(acct, 'File Count') || '0', 10),
        activeFileCount: parseInt(rpt(acct, 'activeFileCount') || rpt(acct, 'Active File Count') || '0', 10),
        lastActivityDate: rpt(acct, 'lastActivityDate') || rpt(acct, 'Last Activity Date') || '',
      });
    }

    oneDriveSites.sort((a, b) => b.storageUsedBytes - a.storageUsedBytes);

    const totalStorage = oneDriveSites.reduce((sum, s) => sum + s.storageUsedBytes, 0);
    const totalFiles = oneDriveSites.reduce((sum, s) => sum + s.fileCount, 0);

    data.onedrive_sites = oneDriveSites;
    data.onedrive_counts = {
      total_accounts: oneDriveSites.length,
      total_files: totalFiles,
      total_storage_bytes: totalStorage,
      total_storage_gb: parseFloat((totalStorage / (1024 * 1024 * 1024)).toFixed(2)),
    };
  } catch (e) {
    console.warn(`[Fetcher] OneDrive usage failed for ${tenantId}:`, e.message);
    data.onedrive_sites = [];
    data.onedrive_counts = { total_accounts: 0, total_files: 0, total_storage_bytes: 0, total_storage_gb: 0 };
  }

  return data;
}

// ─── Exchange Mailbox Usage ───
async function fetchExchangeUsage(tenantId) {
  const data = {};

  try {
    const report = await graph.callGraph(tenantId,
      reportUrl("/reports/getMailboxUsageDetail(period='D7')"),
      REPORT_OPTS
    );
    const mailboxes = parseReport(report);

    data.mailbox_usage = mailboxes.filter(m => !(rpt(m, 'isDeleted') === 'True' || rpt(m, 'isDeleted') === true)).map(m => ({
      displayName: rpt(m, 'displayName') || rpt(m, 'Display Name') || '',
      upn: rpt(m, 'userPrincipalName') || rpt(m, 'User Principal Name') || '',
      storageUsedBytes: parseInt(rpt(m, 'storageUsedInBytes') || rpt(m, 'Storage Used (Byte)') || '0', 10),
      itemCount: parseInt(rpt(m, 'itemCount') || rpt(m, 'Item Count') || '0', 10),
      lastActivity: rpt(m, 'lastActivityDate') || rpt(m, 'Last Activity Date') || '',
    }));

    data.mailbox_usage.sort((a, b) => b.storageUsedBytes - a.storageUsedBytes);

    const active = data.mailbox_usage;
    const totalStorage = active.reduce((sum, m) => sum + m.storageUsedBytes, 0);
    data.mailbox_counts = {
      total: active.length,
      active_7d: active.filter(m => m.lastActivity).length,
      total_storage_bytes: totalStorage,
      total_storage_gb: parseFloat((totalStorage / (1024 * 1024 * 1024)).toFixed(2)),
      avg_storage_mb: active.length > 0
        ? parseFloat((totalStorage / active.length / (1024 * 1024)).toFixed(2))
        : 0,
    };
  } catch (e) {
    console.warn(`[Fetcher] Exchange mailbox usage failed for ${tenantId}:`, e.message);
    data.mailbox_usage = [];
    data.mailbox_counts = { total: 0, active_7d: 0, total_storage_bytes: 0, total_storage_gb: 0, avg_storage_mb: 0 };
  }

  // Mail activity
  try {
    const activity = await graph.callGraph(tenantId,
      reportUrl("/reports/getEmailActivityCounts(period='D7')"),
      REPORT_OPTS
    );
    const actRows = parseReport(activity);
    data.mail_activity = actRows.map(a => ({
      date: rpt(a, 'reportDate') || rpt(a, 'Report Date') || '',
      send: parseInt(rpt(a, 'send') || rpt(a, 'Send') || '0', 10),
      receive: parseInt(rpt(a, 'receive') || rpt(a, 'Receive') || '0', 10),
      read: parseInt(rpt(a, 'read') || rpt(a, 'Read') || '0', 10),
    }));
  } catch (e) {
    console.warn(`[Fetcher] Exchange mail activity failed for ${tenantId}:`, e.message);
    data.mail_activity = [];
  }

  return data;
}

// ─── MFA Registration ───
async function fetchMfaStatus(tenantId) {
  const data = {};

  try {
    const mfaReport = await graph.callGraphPaged(tenantId,
      '/reports/authenticationMethods/userRegistrationDetails?$select=id,userPrincipalName,userDisplayName,isMfaRegistered,isMfaCapable,methodsRegistered&$top=999');
    const users = mfaReport || [];
    const mfaRegistered = users.filter(u => u.isMfaRegistered);
    const mfaCapable = users.filter(u => u.isMfaCapable);

    data.mfa_status = {
      total_users: users.length,
      mfa_registered: mfaRegistered.length,
      mfa_capable: mfaCapable.length,
      mfa_not_registered: users.length - mfaRegistered.length,
      registration_percentage: users.length > 0
        ? parseFloat(((mfaRegistered.length / users.length) * 100).toFixed(2))
        : 0,
    };
    data.mfa_not_registered_users = users
      .filter(u => !u.isMfaRegistered)
      .map(u => ({ name: u.userDisplayName, upn: u.userPrincipalName }));
  } catch (e) {
    console.warn(`[Fetcher] MFA registration failed for ${tenantId}:`, e.message);
    data.mfa_status = { total_users: 0, mfa_registered: 0, mfa_capable: 0, mfa_not_registered: 0, registration_percentage: 0 };
    data.mfa_not_registered_users = [];
  }

  return data;
}

// ─── Teams Usage ───
async function fetchTeamsUsage(tenantId) {
  const data = {};

  try {
    const teams = await graph.callGraphPaged(tenantId, "/groups?$filter=resourceProvisioningOptions/Any(x:x eq 'Team')&$select=id,displayName,description,visibility,createdDateTime&$top=999");
    data.teams_list = (teams || []).map(t => ({ id: t.id, name: t.displayName, visibility: t.visibility, created: t.createdDateTime }));
    data.teams_counts = {
      total: (teams || []).length,
      public: (teams || []).filter(t => t.visibility === 'Public').length,
      private: (teams || []).filter(t => t.visibility === 'Private').length,
    };
  } catch (e) {
    console.warn(`[Fetcher] Teams list failed for ${tenantId}:`, e.message);
    data.teams_list = [];
    data.teams_counts = { total: 0, public: 0, private: 0 };
  }

  try {
    const activity = await graph.callGraph(tenantId,
      reportUrl("/reports/getTeamsUserActivityCounts(period='D7')"), REPORT_OPTS);
    const taRows = parseReport(activity);
    data.teams_activity = taRows.map(a => ({
      date: rpt(a, 'reportDate') || '',
      teamChatMessages: parseInt(rpt(a, 'teamChatMessages') || '0', 10),
      privateChatMessages: parseInt(rpt(a, 'privateChatMessages') || '0', 10),
      calls: parseInt(rpt(a, 'calls') || '0', 10),
      meetings: parseInt(rpt(a, 'meetings') || '0', 10),
    }));
  } catch (e) {
    console.warn(`[Fetcher] Teams activity failed for ${tenantId}:`, e.message);
    data.teams_activity = [];
  }

  return data;
}

// ─── Risky Users ───
async function fetchRiskyUsers(tenantId) {
  const data = {};

  try {
    const riskyUsers = await graph.callGraph(tenantId,
      "/identityProtection/riskyUsers?$select=id,userPrincipalName,userDisplayName,riskLevel,riskState,riskDetail,riskLastUpdatedDateTime&$filter=riskState eq 'atRisk' or riskState eq 'confirmedCompromised'&$top=100",
      { retries: 1, silent: true }
    );
    const users = riskyUsers?.value || [];
    data.risky_users = users.map(u => ({
      name: u.userDisplayName, upn: u.userPrincipalName,
      riskLevel: u.riskLevel, riskState: u.riskState, lastUpdated: u.riskLastUpdatedDateTime,
    }));
    data.risky_user_counts = {
      total: users.length,
      high: users.filter(u => u.riskLevel === 'high').length,
      medium: users.filter(u => u.riskLevel === 'medium').length,
      low: users.filter(u => u.riskLevel === 'low').length,
    };
  } catch (e) {
    if (e.statusCode === 403) {
      console.log(`[Fetcher] Risky users skipped for ${tenantId} (no P2 license)`);
    } else {
      console.warn(`[Fetcher] Risky users failed for ${tenantId}:`, e.message);
    }
    data.risky_users = [];
    data.risky_user_counts = { total: 0, high: 0, medium: 0, low: 0 };
  }

  return data;
}


// ═══════════════════════════════════════════
// SLOW-TIER FETCHERS (every Nth poll)
// ═══════════════════════════════════════════

// ─── Global Admins ───
async function fetchGlobalAdmins(tenantId) {
  try {
    const roles = await graph.callGraphPaged(tenantId, "/directoryRoles?$filter=displayName eq 'Global Administrator'");
    const gaRole = (roles || [])[0];
    if (!gaRole) return { global_admins: { count: 0, admins: [] } };

    const members = await graph.callGraphPaged(tenantId,
      `/directoryRoles/${gaRole.id}/members?$select=id,displayName,userPrincipalName,accountEnabled,assignedLicenses`);
    return {
      global_admins: {
        count: members.length,
        admins: members.map(m => ({
          displayName: m.displayName,
          userPrincipalName: m.userPrincipalName,
          enabled: m.accountEnabled,
          licensed: (m.assignedLicenses || []).length > 0,
        })),
      }
    };
  } catch (e) {
    console.warn(`[Fetcher] Global admins failed for ${tenantId}:`, e.message);
    return { global_admins: { count: 0, admins: [], error: e.message } };
  }
}

// ─── Conditional Access Policies ───
async function fetchConditionalAccess(tenantId) {
  try {
    const policies = await graph.callGraphPaged(tenantId, '/identity/conditionalAccess/policies');

    const parsed = (policies || []).map(p => {
      const conditions = [];
      const controls = [];

      if (p.conditions?.users?.includeUsers?.includes('All')) conditions.push('All users');
      else if (p.conditions?.users?.includeUsers?.length) conditions.push(`${p.conditions.users.includeUsers.length} users`);
      if (p.conditions?.users?.includeGroups?.length) conditions.push(`${p.conditions.users.includeGroups.length} groups`);
      if (p.conditions?.applications?.includeApplications?.includes('All')) conditions.push('All apps');
      else if (p.conditions?.applications?.includeApplications?.length) conditions.push(`${p.conditions.applications.includeApplications.length} apps`);
      if (p.conditions?.platforms?.includePlatforms?.length) conditions.push(`Platforms: ${p.conditions.platforms.includePlatforms.join(', ')}`);
      if (p.conditions?.locations) conditions.push('Location-based');
      if (p.conditions?.signInRiskLevels?.length) conditions.push(`Sign-in risk: ${p.conditions.signInRiskLevels.join(', ')}`);
      if (p.conditions?.userRiskLevels?.length) conditions.push(`User risk: ${p.conditions.userRiskLevels.join(', ')}`);

      if (p.grantControls?.builtInControls?.includes('mfa')) controls.push('Require MFA');
      if (p.grantControls?.builtInControls?.includes('compliantDevice')) controls.push('Require compliant device');
      if (p.grantControls?.builtInControls?.includes('domainJoinedDevice')) controls.push('Require domain-joined device');
      if (p.grantControls?.builtInControls?.includes('block')) controls.push('Block access');
      if (p.sessionControls?.signInFrequency) controls.push(`Sign-in freq: ${p.sessionControls.signInFrequency.value} ${p.sessionControls.signInFrequency.type}`);

      return {
        name: p.displayName,
        state: p.state,
        conditions: conditions.join('; ') || 'Custom',
        controls: controls.join('; ') || 'Custom',
        created: p.createdDateTime,
        modified: p.modifiedDateTime,
      };
    });

    return { conditional_access: parsed };
  } catch (e) {
    if (e.statusCode === 403) {
      console.log(`[Fetcher] Conditional Access skipped for ${tenantId} (no Premium P1)`);
    } else {
      console.warn(`[Fetcher] Conditional Access failed for ${tenantId}:`, e.message);
    }
    return { conditional_access: { error: e.message, note: 'Requires Azure AD Premium P1+' } };
  }
}

// ─── Security Defaults ───
async function fetchSecurityDefaults(tenantId) {
  try {
    const result = await graph.callGraph(tenantId, '/policies/identitySecurityDefaultsEnforcementPolicy');
    return { security_defaults: { isEnabled: result.isEnabled || false, displayName: result.displayName || 'Security Defaults' } };
  } catch (e) {
    console.warn(`[Fetcher] Security Defaults failed for ${tenantId}:`, e.message);
    return { security_defaults: { isEnabled: 'unknown', error: e.message } };
  }
}

// ─── Configured Domains + DNS Verification ───
async function fetchDomains(tenantId) {
  try {
    const domains = await graph.callGraphPaged(tenantId, '/domains');
    const domainResults = [];

    for (const d of (domains || [])) {
      const entry = {
        name: d.id,
        isDefault: d.isDefault || false,
        isVerified: d.isVerified || false,
        authenticationType: d.authenticationType || 'unknown',
        supportedServices: d.supportedServices || [],
        dnsRecordStatus: [],
        dnsVerification: null,
      };

      // Get expected DNS records
      let configRecords = [];
      try {
        configRecords = await graph.callGraphPaged(tenantId, `/domains/${d.id}/serviceConfigurationRecords`);
        configRecords = (configRecords || []).map(r => {
          const odataType = r['@odata.type'] || '';
          let recordType = 'Unknown';
          if (odataType.includes('Mx')) recordType = 'MX';
          else if (odataType.includes('Txt')) recordType = 'TXT';
          else if (odataType.includes('Cname')) recordType = 'CNAME';
          else if (odataType.includes('Srv')) recordType = 'SRV';
          return {
            recordType,
            label: r.label || '',
            expectedValue: r.text || r.nameTarget || r.mailExchange || r.canonicalName || '',
            service: r.supportedService || '',
          };
        });
      } catch (err) {
        // Skip DNS records if not accessible
      }

      // Verify DNS for verified domains
      if (d.isVerified && configRecords.length > 0) {
        entry.dnsRecordStatus = await verifyDnsRecords(d.id, configRecords);
      }

      // Detailed email DNS for default domain
      if (d.isDefault && d.isVerified) {
        entry.dnsVerification = await verifyEmailDns(d.id);
      }

      domainResults.push(entry);
    }

    return { domains: domainResults };
  } catch (e) {
    console.warn(`[Fetcher] Domains failed for ${tenantId}:`, e.message);
    return { domains: [] };
  }
}

// DNS verification helpers (simplified from PA)
async function verifyDnsRecords(domainName, expectedRecords) {
  const results = [];
  const normalize = s => s.toLowerCase().replace(/\.+$/, '');

  for (const rec of expectedRecords) {
    const entry = { type: rec.recordType, service: rec.service, name: rec.label || '@', expectedValue: rec.expectedValue, actualValue: '', status: 'Unknown' };
    let queryName = domainName;
    if (rec.label && rec.label !== '@') {
      queryName = rec.label.toLowerCase().endsWith(domainName.toLowerCase()) ? rec.label : `${rec.label}.${domainName}`;
    }

    try {
      switch (rec.recordType) {
        case 'MX': {
          const answers = await dohQuery(queryName, 'MX');
          const parsed = answers.filter(a => a.type === 15).map(a => { const parts = a.data.split(/\s+/); return { priority: parseInt(parts[0], 10), exchange: parts.slice(1).join(' ') }; });
          const found = parsed.find(r => normalize(r.exchange) === normalize(rec.expectedValue));
          entry.status = found ? 'OK' : parsed.length > 0 ? 'Mismatch' : 'Missing';
          entry.actualValue = parsed.map(r => `${r.priority} ${r.exchange}`).join('; ');
          break;
        }
        case 'TXT': {
          const answers = await dohQuery(queryName, 'TXT');
          const allTxt = answers.filter(a => a.type === 16).map(a => a.data.replace(/^"|"$/g, '').replace(/""/g, '"'));
          const found = allTxt.find(t => t.includes(rec.expectedValue) || rec.expectedValue.includes(t));
          if (found) { entry.actualValue = found; entry.status = 'OK'; }
          else {
            const spf = allTxt.find(t => t.startsWith('v=spf1') && rec.expectedValue.startsWith('v=spf1'));
            if (spf) { entry.actualValue = spf; entry.status = spf.includes('include:spf.protection.outlook.com') ? 'OK' : 'Mismatch'; }
            else { entry.actualValue = allTxt[0] || ''; entry.status = allTxt.length > 0 ? 'Mismatch' : 'Missing'; }
          }
          break;
        }
        case 'CNAME': {
          const answers = await dohQuery(queryName, 'CNAME');
          const cnames = answers.filter(a => a.type === 5).map(a => a.data);
          entry.actualValue = cnames[0] || '';
          entry.status = cnames.some(r => normalize(r) === normalize(rec.expectedValue)) ? 'OK' : cnames.length > 0 ? 'Mismatch' : 'Missing';
          break;
        }
        case 'SRV': {
          const answers = await dohQuery(queryName, 'SRV');
          const parsed = answers.filter(a => a.type === 33).map(a => { const p = a.data.split(/\s+/); return { priority: p[0], weight: p[1], port: p[2], name: p[3] }; });
          const found = parsed.find(r => normalize(r.name) === normalize(rec.expectedValue));
          entry.status = found ? 'OK' : parsed.length > 0 ? 'Mismatch' : 'Missing';
          entry.actualValue = parsed.map(r => `${r.priority} ${r.weight} ${r.port} ${r.name}`).join('; ');
          break;
        }
        default: entry.status = 'Unsupported';
      }
    } catch (err) {
      entry.status = err.code === 'ETIMEOUT' ? 'Timeout' : err.code === 'ENOTFOUND' || err.code === 'ENODATA' ? 'Missing' : 'Error';
    }
    results.push(entry);
    await sleep(100);
  }
  return results;
}

async function verifyEmailDns(domainName) {
  const results = { domain: domainName, checkedAt: new Date().toISOString(), mx: { status: 'unknown' }, spf: { status: 'unknown' }, dmarc: { status: 'unknown' }, autodiscover: { status: 'unknown' } };

  // MX
  try {
    const answers = await dohQuery(domainName, 'MX');
    const parsed = answers.filter(a => a.type === 15).map(a => { const p = a.data.split(/\s+/); return { exchange: p.slice(1).join(' ').replace(/\.+$/, ''), priority: parseInt(p[0], 10) }; });
    results.mx.found = parsed;
    results.mx.status = parsed.some(r => r.exchange.toLowerCase().includes('mail.protection.outlook.com')) ? 'OK' : 'MISMATCH';
  } catch (e) { results.mx.status = 'ERROR'; }

  // SPF
  try {
    const answers = await dohQuery(domainName, 'TXT');
    const allTxt = answers.filter(a => a.type === 16).map(a => a.data.replace(/^"|"$/g, '').replace(/""/g, '"'));
    const spf = allTxt.find(t => t.startsWith('v=spf1'));
    if (spf) {
      results.spf.found = spf;
      results.spf.status = spf.includes('include:spf.protection.outlook.com') ? 'OK' : 'MISMATCH';
      results.spf.mechanism = spf.endsWith('-all') ? '-all (hard fail)' : spf.endsWith('~all') ? '~all (soft fail)' : 'other';
    } else { results.spf.status = 'MISSING'; }
  } catch (e) { results.spf.status = 'ERROR'; }

  // DMARC
  try {
    const answers = await dohQuery(`_dmarc.${domainName}`, 'TXT');
    const allTxt = answers.filter(a => a.type === 16).map(a => a.data.replace(/^"|"$/g, '').replace(/""/g, '"'));
    const dmarc = allTxt.find(t => t.startsWith('v=DMARC1'));
    if (dmarc) {
      results.dmarc.found = dmarc;
      const pm = dmarc.match(/;\s*p=(\w+)/);
      results.dmarc.policy = pm ? pm[1] : 'none';
      results.dmarc.status = results.dmarc.policy === 'reject' ? 'OK' : results.dmarc.policy === 'quarantine' ? 'WARNING' : 'WEAK';
    } else { results.dmarc.status = 'MISSING'; }
  } catch (e) { results.dmarc.status = e.code === 'ENOTFOUND' || e.code === 'ENODATA' ? 'MISSING' : 'ERROR'; }

  // Autodiscover
  try {
    const answers = await dohQuery(`autodiscover.${domainName}`, 'CNAME');
    const cnames = answers.filter(a => a.type === 5).map(a => a.data.replace(/\.+$/, ''));
    results.autodiscover.found = cnames;
    results.autodiscover.status = cnames.some(r => r.toLowerCase().includes('autodiscover.outlook.com')) ? 'OK' : 'MISMATCH';
  } catch (e) { results.autodiscover.status = e.code === 'ENOTFOUND' || e.code === 'ENODATA' ? 'MISSING' : 'ERROR'; }

  return results;
}

// ─── Entra Connect Status ───
async function fetchEntraConnect(tenantId) {
  try {
    const result = await graph.callGraph(tenantId, '/organization');
    const org = (result?.value || [])[0] || {};
    return {
      entra_connect: {
        displayName: org.displayName,
        onPremisesSyncEnabled: org.onPremisesSyncEnabled || false,
        onPremisesLastSyncDateTime: org.onPremisesLastSyncDateTime || null,
        verifiedDomains: (org.verifiedDomains || []).map(d => d.name),
      }
    };
  } catch (e) {
    console.warn(`[Fetcher] Entra Connect failed for ${tenantId}:`, e.message);
    return { entra_connect: { onPremisesSyncEnabled: 'unknown', error: e.message } };
  }
}

// ─── Registered Applications ───
async function fetchApplications(tenantId) {
  try {
    const apps = await graph.callGraphPaged(tenantId, '/applications?$select=displayName,appId,createdDateTime,web,signInAudience&$top=999');
    return {
      registered_apps: (apps || []).map(a => ({
        displayName: a.displayName,
        appId: a.appId,
        created: a.createdDateTime,
        homepage: a.web?.homePageUrl || '',
        signInAudience: a.signInAudience,
      })).sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''))
    };
  } catch (e) {
    console.warn(`[Fetcher] Registered apps failed for ${tenantId}:`, e.message);
    return { registered_apps: [] };
  }
}

// ─── Enterprise Applications ───
async function fetchEnterpriseApps(tenantId) {
  try {
    const MICROSOFT_TENANT_ID = 'f8cdef31-a31e-4b4a-93e4-5f571e91255a';
    const sps = await graph.callGraphPaged(tenantId,
      '/servicePrincipals?$select=displayName,appId,servicePrincipalType,accountEnabled,createdDateTime,appOwnerOrganizationId,publisherName&$top=999');

    const filtered = (sps || []).filter(sp => {
      if (sp.appOwnerOrganizationId === MICROSOFT_TENANT_ID) return false;
      if (sp.servicePrincipalType === 'ManagedIdentity') return false;
      return true;
    });

    return {
      enterprise_apps: filtered.map(sp => ({
        displayName: sp.displayName,
        appId: sp.appId,
        type: sp.servicePrincipalType || 'Application',
        enabled: sp.accountEnabled,
        created: sp.createdDateTime,
        publisher: sp.publisherName || '',
      })).sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''))
    };
  } catch (e) {
    console.warn(`[Fetcher] Enterprise apps failed for ${tenantId}:`, e.message);
    return { enterprise_apps: [] };
  }
}

// ─── Mail Forwarding Rules / Inbox Rules ───
// Returns ALL enabled inbox rules per user (not only forwarding ones) so the
// snapshot-delta alert engine can detect rule creation, modification (via
// actionHash), and external-forwarding creation from a single snapshot.
async function fetchMailForwarding(tenantId) {
  try {
    // Get verified domains for internal/external classification
    const orgResult = await graph.callGraph(tenantId, '/organization');
    const org = (orgResult?.value || [])[0] || {};
    const orgDomains = (org.verifiedDomains || []).map(d => d.name.toLowerCase());

    const users = await graph.callGraphPaged(tenantId, '/users?$select=id,displayName,userPrincipalName&$filter=accountEnabled eq true&$top=999');

    const allRules = [];
    const failedUsers = [];     // real per-user failures (5xx, unexpected 4xx, network) — surfaced in UI
    let usersSkippedNoMailbox = 0; // 404s — expected when an account has no Exchange mailbox provisioned

    for (const u of (users || [])) {
      try {
        // Apr 2026: was callGraph (single-page). Graph's default page for messageRules
        // can silently drop rules beyond page 1 on mailboxes with many rules. Use
        // callGraphPaged which follows @odata.nextLink. $top=100 matches Graph's
        // practical per-mailbox rule ceiling; maxPages=5 is a safety cap.
        const rules = await graph.callGraphPaged(tenantId,
          `/users/${u.id}/mailFolders/inbox/messageRules?$select=id,displayName,isEnabled,actions&$top=100`,
          { silent: true, maxPages: 5 });

        for (const rule of (rules || [])) {
          if (!rule.isEnabled) continue;

          // Classify forwarding targets (may be absent for non-forwarding rules)
          const targets = [
            ...(rule.actions?.forwardTo || []),
            ...(rule.actions?.redirectTo || []),
            ...(rule.actions?.forwardAsAttachmentTo || []),
          ];
          const targetAddresses = targets.map(t => t.emailAddress?.address || t.emailAddress?.name || 'Unknown');
          const externalTargets = targetAddresses.filter(addr => {
            const domain = (addr.split('@')[1] || '').toLowerCase();
            return domain && !orgDomains.includes(domain);
          });

          allRules.push({
            user: u.displayName,
            userPrincipalName: u.userPrincipalName,
            ruleId: rule.id,                      // stable identity across renames
            ruleName: rule.displayName,
            actions: rule.actions || {},          // full action blob for downstream inspection
            actionHash: hashActions(rule.actions), // stable hash for modification detection
            targets: targetAddresses,
            externalTargets,
            isExternal: externalTargets.length > 0,
            hasForwardingAction: targetAddresses.length > 0,
          });
        }
      } catch (e) {
        // Apr 2026: previously swallowed silently. Now we distinguish expected
        // 404s (unprovisioned/shared-only mailboxes) from real failures so the
        // dashboard can surface a warning badge when coverage is incomplete.
        if (e.statusCode === 404) {
          usersSkippedNoMailbox++;
        } else {
          failedUsers.push({
            userPrincipalName: u.userPrincipalName,
            displayName: u.displayName,
            statusCode: e.statusCode || null,
            message: e.message,
          });
          if (process.env.PANOPTICA_DEBUG === '1') {
            console.warn(`[Fetcher] messageRules failed for ${u.userPrincipalName} [${tenantId}]: ${e.statusCode || '?'} ${e.message}`);
          }
        }
      }
    }

    if (failedUsers.length > 0) {
      console.warn(`[Fetcher] Mail forwarding: ${failedUsers.length} user fetch(es) failed for ${tenantId} (set PANOPTICA_DEBUG=1 for per-user detail; also surfaced in snapshot.mail_forwarding.failedUsers)`);
    }

    return {
      mail_forwarding: {
        // Preserve original `rules` semantics for dashboard backward-compat:
        // the dashboard's "Forwarding Rules" stat card reads mf.rules.length.
        rules: allRules.filter(r => r.hasForwardingAction),
        externalRules: allRules.filter(r => r.isExternal),
        // Full list of ALL enabled inbox rules, including non-forwarding ones
        // (e.g., move-to-folder). Consumed by the snapshot-delta evaluators for
        // Inbox rule created/modified detection AND by the "All Inbox Rules"
        // dashboard panel (Apr 2026).
        allRules,
        usersChecked: (users || []).length,
        usersSkippedNoMailbox,  // expected 404s — not an error
        failedUsers,            // real failures — dashboard shows a warning badge when non-empty
        orgDomains,
      }
    };
  } catch (e) {
    console.warn(`[Fetcher] Mail forwarding failed for ${tenantId}:`, e.message);
    return { mail_forwarding: { rules: [], externalRules: [], allRules: [], usersChecked: 0, usersSkippedNoMailbox: 0, failedUsers: [], orgDomains: [] } };
  }
}

// ─── Mailbox-level Forwarding (Apr 28, 2026) ───
//
// Companion to fetchMailForwarding. That fetcher covers per-rule forwarding
// via /users/{id}/mailFolders/inbox/messageRules. This fetcher covers the
// other vector: tenant-admin-set or user-set Set-Mailbox -ForwardingSmtpAddress
// — the "forward all my mail to X" switch which lives on the mailbox itself,
// not on an inbox rule.
//
// Why PowerShell, not Graph: Microsoft Graph's /users/{id}/mailboxSettings
// does NOT expose forwardingSmtpAddress / forwardingAddress / deliverTo-
// MailboxAndForward (verified Apr 28). Get-Mailbox is the only API surface.
// One cmdlet returns the whole tenant in a single call, so this is actually
// cheaper than the per-user Graph loop used by fetchMailForwarding.
//
// Tenants where Connect-ExchangeOnline fails (no role bootstrap, no GDAP)
// return an empty snapshot with a recorded reason — the caller treats this
// as "no signal", not as "all clear".
async function fetchMailboxLevelForwarding(tenantId) {
  const cmdlet = "Get-Mailbox -ResultSize Unlimited -RecipientTypeDetails UserMailbox " +
                 "| select PrimarySmtpAddress,ForwardingSmtpAddress,ForwardingAddress,DeliverToMailboxAndForward " +
                 "| ConvertTo-Json -Compress -Depth 4";

  let raw;
  try {
    raw = await runExoCmdlet(tenantId, cmdlet, { timeoutMs: 60000 });
  } catch (e) {
    console.warn(`[Fetcher] Mailbox-level forwarding pwsh call failed for ${tenantId}: ${e.code || ''} ${e.message}`);
    return {
      mailbox_forwarding: {
        users: [],
        usersChecked: 0,
        skippedReason: e.message || 'pwsh error',
        skippedCode: e.code || null,
      }
    };
  }

  // Get-Mailbox returns either an array (multi-mailbox tenant) or a single
  // object (one mailbox). Normalize.
  const arr = Array.isArray(raw) ? raw : (raw ? [raw] : []);

  const users = arr.map(row => {
    const upn = (row.PrimarySmtpAddress || '').toLowerCase();
    const fwdSmtp = (row.ForwardingSmtpAddress || '').replace(/^smtp:/i, '').toLowerCase().trim();
    const fwdAddr = (row.ForwardingAddress || '').trim(); // internal recipient — stays as-is
    const deliverAndForward = !!row.DeliverToMailboxAndForward;
    const hasForwarding = fwdSmtp.length > 0 || fwdAddr.length > 0;
    return {
      upn,
      forwardingSmtpAddress: fwdSmtp || null,
      forwardingAddress: fwdAddr || null,
      deliverToMailboxAndForward: deliverAndForward,
      hasForwarding,
    };
  }).filter(u => u.upn); // drop anything missing PrimarySmtpAddress

  // Mark external-target users (forwardingSmtpAddress to non-org domain).
  // We need verified domains — fetched live to avoid stale snapshot drift.
  let orgDomains = [];
  try {
    const orgResult = await graph.callGraph(tenantId, '/organization');
    const org = (orgResult?.value || [])[0] || {};
    orgDomains = (org.verifiedDomains || []).map(d => d.name.toLowerCase());
  } catch (e) {
    console.warn(`[Fetcher] Could not fetch verifiedDomains for ${tenantId}; treating all forwarding as external`);
  }

  for (const u of users) {
    const dom = (u.forwardingSmtpAddress?.split('@')[1] || '').toLowerCase();
    u.isExternal = u.forwardingSmtpAddress != null && (dom === '' || !orgDomains.includes(dom));
  }

  return {
    mailbox_forwarding: {
      users,
      usersChecked: users.length,
      forwardingUsers: users.filter(u => u.hasForwarding),
      externalForwardingUsers: users.filter(u => u.isExternal),
      orgDomains,
    }
  };
}

// ─── Inactive Users (90 days) ───
// Microsoft Graph's signInActivity property requires Microsoft Entra ID P1/P2.
// Without P1, the property is null for users who lack it (per-user gating) OR for
// every user if no P1 exists in the tenant at all. We classify users as:
//   - inactive: lastSignIn known and stale, OR lastSignIn null AND user/tenant has P1
//   - data_unavailable: lastSignIn null AND no P1 visibility → counted only, not listed
// This is robust under both per-user and tenant-level gating models.
const ENTRA_P1_PLAN_IDS = new Set([
  '41781fb2-bc02-4b7c-bd55-b576c07bb09d', // AAD_PREMIUM (Entra ID P1)
  'eec0eb4f-6444-4f95-aba0-50c24d67f998', // AAD_PREMIUM_P2 (Entra ID P2)
]);

function userHasEntraP1(u) {
  const plans = u.assignedPlans || [];
  for (const p of plans) {
    if (ENTRA_P1_PLAN_IDS.has(p.servicePlanId) && p.capabilityStatus === 'Enabled') return true;
  }
  return false;
}

async function fetchInactiveUsers(tenantId) {
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const cutoff = ninetyDaysAgo.toISOString();

  try {
    let users;
    try {
      users = await graph.callGraphPaged(tenantId, '/users?$select=id,displayName,userPrincipalName,accountEnabled,userType,createdDateTime,signInActivity,assignedLicenses,assignedPlans&$top=999');
    } catch (e) {
      users = await graph.callGraphPaged(tenantId, '/users?$select=id,displayName,userPrincipalName,accountEnabled,userType,createdDateTime,assignedLicenses,assignedPlans&$top=999');
    }

    const internalInactive = [];
    const externalInactive = [];
    let internalDataUnavailable = 0;
    let externalDataUnavailable = 0;

    // Pre-compute tenant-level P1 presence. Used as the gate for guests since they
    // typically don't carry licenses themselves.
    const tenantHasP1 = (users || []).some(u => userHasEntraP1(u));

    for (const u of (users || [])) {
      if (!u.accountEnabled) continue;
      const lastSignIn = u.signInActivity?.lastSignInDateTime || u.signInActivity?.lastNonInteractiveSignInDateTime || null;
      const isExternal = u.userType === 'Guest';
      const p1Visible = isExternal ? tenantHasP1 : userHasEntraP1(u);

      // Active recently → exclude entirely.
      if (lastSignIn && lastSignIn >= cutoff) continue;

      // No sign-in data AND no P1 visibility → cannot determine; count only.
      if (!lastSignIn && !p1Visible) {
        if (isExternal) externalDataUnavailable++;
        else internalDataUnavailable++;
        continue;
      }

      // Either: lastSignIn known and < cutoff, OR lastSignIn null with P1 visibility (truly never).
      if (isExternal) {
        externalInactive.push({
          displayName: u.displayName,
          userPrincipalName: u.userPrincipalName,
          lastSignIn: lastSignIn || 'Never',
          created: u.createdDateTime,
        });
      } else {
        internalInactive.push({
          displayName: u.displayName,
          userPrincipalName: u.userPrincipalName,
          lastSignIn: lastSignIn || 'Never',
          licensed: (u.assignedLicenses || []).length > 0,
        });
      }
    }

    return {
      inactive_users: {
        internalInactive,
        externalInactive,
        internalDataUnavailable,
        externalDataUnavailable,
        tenantHasP1,
        cutoffDate: cutoff,
      },
    };
  } catch (e) {
    console.warn(`[Fetcher] Inactive users failed for ${tenantId}:`, e.message);
    return {
      inactive_users: {
        internalInactive: [],
        externalInactive: [],
        internalDataUnavailable: 0,
        externalDataUnavailable: 0,
        tenantHasP1: false,
        error: e.message,
      },
    };
  }
}

// ─── Inactive Devices (90 days) ───
async function fetchInactiveDevices(tenantId) {
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const cutoff = ninetyDaysAgo.toISOString();

  try {
    const devices = await graph.callGraphPaged(tenantId,
      '/devices?$select=displayName,operatingSystem,operatingSystemVersion,approximateLastSignInDateTime,registrationDateTime,accountEnabled,trustType&$top=999');

    const inactive = (devices || []).filter(d => {
      if (!d.accountEnabled) return false;
      const last = d.approximateLastSignInDateTime;
      return !last || last < cutoff;
    }).map(d => ({
      displayName: d.displayName,
      os: d.operatingSystem,
      lastActivity: d.approximateLastSignInDateTime || 'Never',
      registered: d.registrationDateTime,
      trustType: d.trustType,
    }));

    return { inactive_devices: { inactive, cutoffDate: cutoff } };
  } catch (e) {
    console.warn(`[Fetcher] Inactive devices failed for ${tenantId}:`, e.message);
    return { inactive_devices: { inactive: [], error: e.message } };
  }
}


// ═══════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════

/**
 * Live-tier fetchers — run every poll cycle.
 * Keys match the service ENUM in metric_snapshots.
 */
const liveFetchers = {
  security:   [fetchSecureScore, fetchMfaStatus, fetchRiskyUsers],
  entra:      [fetchLicensing, fetchDevices],
  exchange:   [fetchExchangeUsage],
  sharepoint: [fetchSharePointUsage],
  onedrive:   [fetchOneDriveUsage],
  teams:      [fetchTeamsUsage],
};

/**
 * Slow-tier fetchers — run every Nth poll.
 * Merged into the same service keys for snapshot storage.
 */
const slowFetchers = {
  security:   [fetchGlobalAdmins, fetchConditionalAccess, fetchSecurityDefaults],
  entra:      [fetchEntraConnect, fetchApplications, fetchEnterpriseApps, fetchInactiveUsers, fetchInactiveDevices],
  exchange:   [fetchMailForwarding, fetchMailboxLevelForwarding],
  sharepoint: [fetchDomains],
};

module.exports = {
  liveFetchers,
  slowFetchers,
};
