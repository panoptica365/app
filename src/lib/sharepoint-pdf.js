/**
 * Panoptica365 — SharePoint Audit PDF Generator
 * Ported from Tabula Accessus lib/pdf-report.js; branded for Panoptica365.
 *
 * ARCHITECTURE NOTE: PDFKit auto-pagination is deliberately disabled
 * (bottom margin = 1). ALL page breaks go through ensureSpace(). This
 * prevents ghost blank pages caused by PDFKit creating pages behind
 * our back. drawText() saves/restores doc.y around every text draw.
 */

const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

// ─── Assets ──────────────────────────────────────────────────────────────────
const PUBLIC_IMG_DIR = path.join(__dirname, '..', '..', 'public', 'img');
const LOGO_PATH = path.join(PUBLIC_IMG_DIR, 'panoptica365-logo.png');
const COVER_PATH = path.join(PUBLIC_IMG_DIR, 'report-cover.png');
function getLogoPath() { return fs.existsSync(LOGO_PATH) ? LOGO_PATH : null; }
function getCoverPath() { return fs.existsSync(COVER_PATH) ? COVER_PATH : null; }

// Panoptica navy/cyan palette — matches css/themes/panoptica-dark.css tokens
const COLORS = {
  accent:       '#1E88E5',  // --p-accent
  accentDeep:   '#1565C0',  // --p-accent-deep
  accentDark:   '#0D47A1',  // --p-accent-dark
  highlight:    '#29B6F6',  // --p-highlight (cyan)
  navy:         '#0A1929',  // --p-bg
  text:         '#1A1A1A',
  textMuted:    '#555555',
  textLight:    '#888888',
  white:        '#FFFFFF',
  border:       '#C5D4E2',
  borderLight:  '#E5ECF3',
  rowAlt:       '#F5F9FC',
  tableHeadBg:  '#E3F2FD',
  // Role badge colors (kept distinct for readability)
  fullControl:  '#D32F2F',
  edit:         '#F57C00',
  contribute:   '#1976D2',
  read:         '#388E3C',
  default:      '#757575',
};

const PAGE = {
  width: 612, height: 792,
  marginLeft: 50, marginRight: 50,
  marginTop: 70, marginBottom: 60,
  get contentWidth() { return this.width - this.marginLeft - this.marginRight; },
  get usableBottom() { return this.height - this.marginBottom; },
};

// ─── helpers ─────────────────────────────────────────────────────────────────

function safe(s) { return s || ''; }
function formatDate(iso) {
  if (!iso) return 'N/A';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
function formatSize(bytes) {
  if (!bytes) return 'N/A';
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return gb.toFixed(2) + ' GB';
  return (bytes / (1024 ** 2)).toFixed(1) + ' MB';
}
function getRoleColor(r) {
  const l = (r || '').toLowerCase();
  if (l.includes('full control')) return COLORS.fullControl;
  if (l.includes('edit') || l.includes('design')) return COLORS.edit;
  if (l.includes('contribute')) return COLORS.contribute;
  if (l.includes('read') || l.includes('view')) return COLORS.read;
  return COLORS.default;
}

// drawText — renders at absolute position WITHOUT letting PDFKit move doc.y.
function drawText(doc, text, x, y, options) {
  const savedY = doc.y;
  doc.text(text, x, y, options);
  doc.y = savedY;
}

// ─── Page chrome ─────────────────────────────────────────────────────────────

function drawPageHeaderFooter(doc, reportTitle, pageNum) {
  const headerY = 20;
  const logo = getLogoPath();
  if (logo) doc.image(logo, PAGE.marginLeft, headerY - 2, { height: 24 });

  doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.accentDeep);
  drawText(doc, 'PANOPTICA365', PAGE.marginLeft + 32, headerY + 2, { width: 120, lineBreak: false });

  doc.font('Helvetica').fontSize(8).fillColor(COLORS.textMuted);
  drawText(doc, reportTitle, PAGE.marginLeft + 32, headerY + 13, {
    width: PAGE.contentWidth - 32, lineBreak: false,
  });

  doc.strokeColor(COLORS.accent).lineWidth(1)
    .moveTo(PAGE.marginLeft, headerY + 28)
    .lineTo(PAGE.width - PAGE.marginRight, headerY + 28)
    .stroke();

  const footerY = PAGE.height - PAGE.marginBottom + 15;
  doc.strokeColor(COLORS.borderLight).lineWidth(0.5)
    .moveTo(PAGE.marginLeft, footerY)
    .lineTo(PAGE.width - PAGE.marginRight, footerY)
    .stroke();

  doc.font('Helvetica').fontSize(8).fillColor(COLORS.textMuted);
  drawText(doc, `Page ${pageNum}`, PAGE.marginLeft, footerY + 8, {
    width: PAGE.contentWidth, align: 'center', lineBreak: false,
  });
}

// ─── Cover page ──────────────────────────────────────────────────────────────
// Full-bleed Panoptica365 cover image with overlaid title text in the upper
// area. Mirrors the pattern used by scripts/generate-pdf-report.py so the
// SharePoint audit reports share the same brand presentation as the Security
// Posture report. Verbose audit metadata is rendered separately via
// addReportDetailsPanel() on the first content page.

function addCoverPage(doc, { reportTitle, subtitle, tenantName }) {
  const cover = getCoverPath();
  if (cover) {
    // Full-bleed cover image
    doc.image(cover, 0, 0, { width: PAGE.width, height: PAGE.height });
  } else {
    // Fallback: navy band + logo if cover asset is missing
    doc.rect(0, 0, PAGE.width, PAGE.height).fill(COLORS.navy);
    const logo = getLogoPath();
    if (logo) doc.image(logo, (PAGE.width - 160) / 2, PAGE.height * 0.35, { width: 160 });
  }

  // Overlay text in the upper area — dark colors against the lighter sky in
  // the cover artwork. Coordinates match the Posture report cover (h*0.78,
  // 0.73, 0.69 from BOTTOM in ReportLab terms = same vertical positions in
  // PDFKit's top-down coords below).
  const titleTop = PAGE.height * 0.22;  // ≈ 174

  doc.font('Helvetica-Bold').fontSize(26).fillColor('#1A2A3A');
  drawText(doc, reportTitle, 0, titleTop, {
    align: 'center', width: PAGE.width, lineBreak: false,
  });

  if (subtitle) {
    doc.font('Helvetica').fontSize(14).fillColor('#2C3E50');
    drawText(doc, subtitle, 0, titleTop + 38, {
      align: 'center', width: PAGE.width, lineBreak: false,
    });
  }

  doc.font('Helvetica').fontSize(16).fillColor('#2C3E50');
  drawText(doc, tenantName, 0, titleTop + (subtitle ? 70 : 44), {
    align: 'center', width: PAGE.width, lineBreak: false,
  });

  doc.font('Helvetica').fontSize(10).fillColor('#4A5568');
  drawText(doc, `Generated ${formatDate(new Date().toISOString())}`,
    0, titleTop + (subtitle ? 96 : 70), {
      align: 'center', width: PAGE.width, lineBreak: false,
    });
}

// ─── Report-details panel ────────────────────────────────────────────────────
// Compact metadata block rendered at the top of the first content page,
// preserving the audit details that previously lived on the procedural title
// page. Advances doc.y to below the panel so subsequent content flows normally.

function addReportDetailsPanel(doc, { tenantName, details }) {
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.accentDeep);
  drawText(doc, 'Report Details', PAGE.marginLeft, doc.y, {
    width: PAGE.contentWidth, lineBreak: false,
  });
  doc.y += 18;

  const rows = [
    { label: 'Tenant', value: tenantName },
    ...details,
    { label: 'Generated', value: formatDate(new Date().toISOString()) },
  ];

  const labelW = 130;
  const lineH = 14;
  rows.forEach((row) => {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.text);
    drawText(doc, row.label + ':', PAGE.marginLeft, doc.y, {
      width: labelW, lineBreak: false,
    });
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.textMuted);
    drawText(doc, String(row.value ?? ''), PAGE.marginLeft + labelW, doc.y, {
      width: PAGE.contentWidth - labelW, lineBreak: false,
    });
    doc.y += lineH;
  });

  doc.y += 6;
  doc.strokeColor(COLORS.borderLight).lineWidth(0.5)
    .moveTo(PAGE.marginLeft, doc.y)
    .lineTo(PAGE.width - PAGE.marginRight, doc.y)
    .stroke();
  doc.y += 14;
}

// ─── Document factory ────────────────────────────────────────────────────────

function createDocument(reportTitle, info) {
  let pageCount = 0;
  const doc = new PDFDocument({
    size: 'letter',
    margins: { top: PAGE.marginTop, bottom: 1, left: PAGE.marginLeft, right: PAGE.marginRight },
    autoFirstPage: true,
    info,
  });

  function newContentPage() {
    doc.addPage();
    pageCount++;
    drawPageHeaderFooter(doc, reportTitle, pageCount);
    doc.y = PAGE.marginTop;
  }
  function ensureSpace(needed) {
    if (doc.y + needed > PAGE.usableBottom) {
      newContentPage();
      return true;
    }
    return false;
  }
  return { doc, newContentPage, ensureSpace };
}

// ─── Permission table ────────────────────────────────────────────────────────

function drawPermissionTable(doc, assignments, ensureSpace) {
  if (!assignments || assignments.length === 0) {
    ensureSpace(20);
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(COLORS.textMuted);
    drawText(doc, 'No permissions found.', PAGE.marginLeft, doc.y, {
      width: PAGE.contentWidth, lineBreak: false,
    });
    doc.y += 16;
    return;
  }

  const col = {
    principal: PAGE.contentWidth * 0.35,
    type:      PAGE.contentWidth * 0.18,
    roles:     PAGE.contentWidth * 0.17,
    members:   PAGE.contentWidth * 0.30,
  };

  ensureSpace(20);
  const headerY = doc.y;
  doc.rect(PAGE.marginLeft, headerY, PAGE.contentWidth, 18).fill(COLORS.tableHeadBg);

  doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.accentDeep);
  let x = PAGE.marginLeft + 4;
  drawText(doc, 'Principal', x, headerY + 5, { width: col.principal, lineBreak: false });
  x += col.principal;
  drawText(doc, 'Type', x, headerY + 5, { width: col.type, lineBreak: false });
  x += col.type;
  drawText(doc, 'Role', x, headerY + 5, { width: col.roles, lineBreak: false });
  x += col.roles;
  drawText(doc, 'Members', x, headerY + 5, { width: col.members, lineBreak: false });

  doc.y = headerY + 20;

  for (let ri = 0; ri < assignments.length; ri++) {
    const a = assignments[ri];
    const memberLines = a.members && a.members.length > 0
      ? a.members.map(m => `${m.displayName} <${m.email || ''}>`)
      : [];
    const principalText = safe(a.principalName) + (a.principalEmail ? ` <${a.principalEmail}>` : '');

    doc.font('Helvetica').fontSize(8);
    const principalH = doc.heightOfString(principalText, { width: col.principal - 8 });
    let membersH = 0;
    if (memberLines.length > 0) {
      doc.font('Helvetica').fontSize(7);
      for (const l of memberLines) membersH += doc.heightOfString(l, { width: col.members - 8 }) + 2;
    }
    const rolesH = (a.roles || []).length * 15;
    const rowH = Math.max(18, principalH + 6, membersH + 6, rolesH + 6);

    ensureSpace(rowH + 2);
    const rowY = doc.y;

    if (ri % 2 === 1) {
      doc.rect(PAGE.marginLeft, rowY, PAGE.contentWidth, rowH).fill(COLORS.rowAlt);
    }
    doc.strokeColor(COLORS.borderLight).lineWidth(0.3)
      .moveTo(PAGE.marginLeft, rowY + rowH)
      .lineTo(PAGE.width - PAGE.marginRight, rowY + rowH).stroke();

    x = PAGE.marginLeft + 4;
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.text);
    drawText(doc, principalText, x, rowY + 3, { width: col.principal - 8, height: rowH, ellipsis: true });
    x += col.principal;

    doc.font('Helvetica').fontSize(7).fillColor(COLORS.textMuted);
    drawText(doc, safe(a.principalType), x, rowY + 4, { width: col.type - 4, lineBreak: false });
    x += col.type;

    let roleY = rowY + 3;
    for (const role of a.roles || []) {
      const rc = getRoleColor(role);
      doc.font('Helvetica-Bold').fontSize(7);
      const rw = doc.widthOfString(role) + 8;
      doc.roundedRect(x, roleY, rw, 12, 2).fill(rc);
      doc.font('Helvetica-Bold').fontSize(7).fillColor(COLORS.white);
      drawText(doc, role, x + 4, roleY + 2.5, { width: rw - 8, lineBreak: false });
      roleY += 15;
    }
    x += col.roles;

    if (memberLines.length > 0) {
      let mY = rowY + 3;
      doc.font('Helvetica').fontSize(7).fillColor(COLORS.textMuted);
      for (const l of memberLines) {
        const lh = doc.heightOfString(l, { width: col.members - 8 });
        drawText(doc, l, x, mY, { width: col.members - 8, height: lh + 2, ellipsis: true });
        mY += lh + 2;
      }
    }

    doc.y = rowY + rowH;
  }
  doc.y += 6;
}

// ─── Report 1: Library Permissions ───────────────────────────────────────────

function generateLibraryPermissionsPDF(auditData, stream) {
  const reportTitle = 'Library Permissions Report';
  const explicitFolders = auditData.foldersWithExplicitPermissions || [];

  const { doc, newContentPage, ensureSpace } = createDocument(reportTitle, {
    Title: `Library Permissions — ${safe(auditData.driveName)} (${safe(auditData.siteName)})`,
    Author: 'Panoptica365',
    Subject: 'SharePoint Library Permissions Audit',
    Creator: 'Panoptica365 — SharePoint Audit',
  });
  doc.pipe(stream);

  addCoverPage(doc, {
    reportTitle: 'Library Permissions Report',
    subtitle: `${safe(auditData.driveName)} — ${safe(auditData.siteName)}`,
    tenantName: safe(auditData.tenantName),
  });

  // First content page: report-details panel, then baseline section
  newContentPage();
  addReportDetailsPanel(doc, {
    tenantName: safe(auditData.tenantName),
    details: [
      { label: 'Site', value: safe(auditData.siteName) },
      { label: 'Library', value: safe(auditData.driveName) },
      { label: 'Folders Scanned', value: String(auditData.foldersScanned || 0) },
      { label: 'Library Size', value: formatSize(auditData.librarySize) },
      { label: 'Explicit Permissions', value: String(explicitFolders.length) },
      { label: 'Audit Date', value: formatDate(auditData.timestamp) },
    ],
  });

  doc.font('Helvetica-Bold').fontSize(16).fillColor(COLORS.accentDeep);
  drawText(doc, 'Baseline Permissions', PAGE.marginLeft, doc.y, { width: PAGE.contentWidth, lineBreak: false });
  doc.y += 24;
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.textMuted);
  drawText(doc, 'These permissions are inherited by all folders in the library unless explicitly overridden.',
    PAGE.marginLeft, doc.y, { width: PAGE.contentWidth, lineBreak: false });
  doc.y += 18;

  drawPermissionTable(doc, auditData.baselinePermissions || [], ensureSpace);

  // Explicit section
  doc.y += 10;
  doc.font('Helvetica-Bold').fontSize(16);
  const hH = doc.heightOfString('Folders with Explicit Permissions', { width: PAGE.contentWidth });
  ensureSpace(hH + 40);
  doc.font('Helvetica-Bold').fontSize(16).fillColor(COLORS.accentDeep);
  drawText(doc, 'Folders with Explicit Permissions', PAGE.marginLeft, doc.y, {
    width: PAGE.contentWidth, lineBreak: false,
  });
  doc.y += hH + 6;

  if (explicitFolders.length === 0) {
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.textMuted);
    drawText(doc,
      'No folders with explicit (non-inherited) permissions were found. All folders inherit the baseline permissions above.',
      PAGE.marginLeft, doc.y, { width: PAGE.contentWidth, lineBreak: false });
    doc.y += 20;
  } else {
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.textMuted);
    drawText(doc,
      `${explicitFolders.length} folder${explicitFolders.length > 1 ? 's' : ''} with permissions that differ from the library baseline.`,
      PAGE.marginLeft, doc.y, { width: PAGE.contentWidth, lineBreak: false });
    doc.y += 20;

    for (let i = 0; i < explicitFolders.length; i++) {
      const folder = explicitFolders[i];
      const label = `${i + 1}. ${safe(folder.folderPath)}`;
      doc.font('Helvetica-Bold').fontSize(9);
      const fh = doc.heightOfString(label, { width: PAGE.contentWidth });
      ensureSpace(fh + 30);
      doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.text);
      drawText(doc, label, PAGE.marginLeft, doc.y, { width: PAGE.contentWidth, lineBreak: false });
      doc.y += fh + 4;
      drawPermissionTable(doc, folder.roleAssignments || [], ensureSpace);
      doc.y += 6;
    }
  }

  doc.end();
  return doc;
}

// ─── Report 2: User Permissions ──────────────────────────────────────────────

function generateUserPermissionsPDF(auditDataList, tenantName, stream) {
  const reportTitle = 'User Permissions Report';

  const userMap = new Map();
  for (const audit of auditDataList) {
    const lib = `${safe(audit.driveName)} (${safe(audit.siteName)})`;
    for (const p of audit.baselinePermissions || []) addToUserMap(userMap, p, lib, '(root — inherited)');
    for (const f of audit.foldersWithExplicitPermissions || []) {
      for (const p of f.roleAssignments || []) addToUserMap(userMap, p, lib, f.folderPath);
    }
  }
  const users = Array.from(userMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  const siteNames = [...new Set(auditDataList.map(a => safe(a.siteName)))];

  const { doc, newContentPage, ensureSpace } = createDocument(reportTitle, {
    Title: `User Permissions — ${safe(tenantName)}`,
    Author: 'Panoptica365',
    Subject: 'SharePoint User Permissions Audit',
    Creator: 'Panoptica365 — SharePoint Audit',
  });
  doc.pipe(stream);

  addCoverPage(doc, {
    reportTitle: 'User Permissions Report',
    subtitle: `All Audited Libraries — ${safe(tenantName)}`,
    tenantName: safe(tenantName),
  });

  newContentPage();
  addReportDetailsPanel(doc, {
    tenantName: safe(tenantName),
    details: [
      { label: 'Libraries Audited', value: String(auditDataList.length) },
      { label: 'Sites', value: siteNames.join(', ') || 'N/A' },
      { label: 'Users/Groups Found', value: String(users.length) },
    ],
  });

  doc.font('Helvetica-Bold').fontSize(16).fillColor(COLORS.accentDeep);
  drawText(doc, 'User & Group Permissions', PAGE.marginLeft, doc.y, { width: PAGE.contentWidth, lineBreak: false });
  doc.y += 24;
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.textMuted);
  drawText(doc,
    `Aggregated permissions across ${auditDataList.length} audited librar${auditDataList.length === 1 ? 'y' : 'ies'}. Each user or group is shown with every location they have access to.`,
    PAGE.marginLeft, doc.y, { width: PAGE.contentWidth, lineBreak: false });
  doc.y += 18;

  for (let i = 0; i < users.length; i++) {
    const u = users[i];
    ensureSpace(24 + Math.min(u.accesses.length * 18, 36));
    const cardY = doc.y;

    doc.rect(PAGE.marginLeft, cardY, PAGE.contentWidth, 20).fill(COLORS.tableHeadBg);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.accentDeep);
    drawText(doc, safe(u.name), PAGE.marginLeft + 6, cardY + 5, { lineBreak: false });
    const nw = doc.font('Helvetica-Bold').fontSize(9).widthOfString(safe(u.name));
    doc.font('Helvetica').fontSize(7).fillColor(COLORS.textMuted);
    drawText(doc, safe(u.type), PAGE.marginLeft + nw + 14, cardY + 6, { lineBreak: false });
    const em = safe(u.email);
    if (em && em !== u.name) {
      doc.font('Helvetica').fontSize(7).fillColor(COLORS.textMuted);
      drawText(doc, em, PAGE.marginLeft + 6, cardY + 5, {
        width: PAGE.contentWidth - 12, align: 'right', lineBreak: false,
      });
    }
    doc.y = cardY + 22;

    for (let j = 0; j < u.accesses.length; j++) {
      const a = u.accesses[j];
      ensureSpace(18);
      const rowY = doc.y;
      if (j % 2 === 0) doc.rect(PAGE.marginLeft + 8, rowY, PAGE.contentWidth - 8, 16).fill(COLORS.rowAlt);

      doc.font('Helvetica-Bold').fontSize(7).fillColor(COLORS.text);
      drawText(doc, safe(a.library), PAGE.marginLeft + 12, rowY + 3, {
        width: PAGE.contentWidth * 0.3, lineBreak: false,
      });
      doc.font('Helvetica').fontSize(7).fillColor(COLORS.textMuted);
      drawText(doc, safe(a.folder), PAGE.marginLeft + 12 + PAGE.contentWidth * 0.3, rowY + 3, {
        width: PAGE.contentWidth * 0.42, lineBreak: false,
      });

      let rx = PAGE.marginLeft + 12 + PAGE.contentWidth * 0.72;
      for (const role of a.roles || []) {
        doc.font('Helvetica-Bold').fontSize(6);
        const rw = doc.widthOfString(role) + 6;
        doc.roundedRect(rx, rowY + 2, rw, 11, 2).fill(getRoleColor(role));
        doc.font('Helvetica-Bold').fontSize(6).fillColor(COLORS.white);
        drawText(doc, role, rx + 3, rowY + 4, { width: rw - 6, lineBreak: false });
        rx += rw + 3;
      }
      doc.y = rowY + 17;
    }
    doc.y += 10;
  }

  if (users.length === 0) {
    ensureSpace(20);
    doc.font('Helvetica-Oblique').fontSize(10).fillColor(COLORS.textMuted);
    drawText(doc, 'No users or groups found in the audited libraries.',
      PAGE.marginLeft, doc.y, { width: PAGE.contentWidth, lineBreak: false });
  }

  doc.end();
  return doc;
}

function addToUserMap(map, perm, libraryLabel, folderPath) {
  const key = `${perm.principalName}::${perm.principalType}`;
  if (!map.has(key)) {
    map.set(key, {
      name: safe(perm.principalName),
      email: safe(perm.principalEmail || perm.loginName),
      type: safe(perm.principalType),
      accesses: [],
    });
  }
  map.get(key).accesses.push({
    library: libraryLabel, folder: folderPath, roles: perm.roles || [],
  });

  if (perm.members && perm.members.length > 0) {
    for (const m of perm.members) {
      const mk = `${m.displayName}::User`;
      if (!map.has(mk)) {
        map.set(mk, {
          name: safe(m.displayName),
          email: safe(m.email),
          type: 'User (via group)',
          accesses: [],
        });
      }
      map.get(mk).accesses.push({
        library: libraryLabel,
        folder: `${folderPath} (via ${safe(perm.principalName)})`,
        roles: perm.roles || [],
      });
    }
  }
}

module.exports = { generateLibraryPermissionsPDF, generateUserPermissionsPDF };
