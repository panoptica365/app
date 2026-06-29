'use strict';

/**
 * Shared template-import error classifier (#20).
 *
 * Maps a raw DB/insert error from a per-item template bulk-import loop to a
 * stable reason CODE (localized client-side via import_reason_* strings) plus a
 * safe English fallback. The raw error stays in the server log and is NEVER
 * returned to the UI, so MySQL internals (error numbers, packet sizes) don't
 * leak into operator-facing text.
 *
 * Used identically by the Intune (src/routes/api-intune.js) and Conditional
 * Access (src/routes/api-ca.js) bulk importers — one source of truth so a new
 * mapping added here covers both. Name collisions are allowed (neither
 * templates table has a UNIQUE on name), so ER_DUP_ENTRY won't fire today;
 * it's mapped anyway to stay correct if a constraint is ever added.
 */
function classifyImportError(err) {
  const code = err && err.code;
  const msg = String((err && err.message) || '').toLowerCase();
  if (code === 'ER_DUP_ENTRY')
    return { reason: 'duplicate_name', error: 'A template with this name already exists' };
  if (code === 'ER_LOCK_DEADLOCK' || code === 'ER_LOCK_WAIT_TIMEOUT')
    return { reason: 'db_busy', error: 'Database busy — retry in a moment' };
  if (code === 'ER_NET_PACKET_TOO_LARGE' || msg.includes('max_allowed_packet') || msg.includes('too large'))
    return { reason: 'too_large', error: 'Policy is too large to import' };
  return { reason: 'generic', error: 'Import failed' };
}

module.exports = { classifyImportError };
