# Bundled Starter Templates — seed pack

This directory holds the curated **Panoptica365** starter-template library that
ships **inside the image** and seeds automatically on **fresh installs only**.

```
seed-templates/
  intune/<slug>.json   ← one Intune template per file
  ca/<slug>.json       ← one Conditional Access template per file
```

## File format

Each file is a self-describing envelope:

```json
{
  "seedFormat": 1,
  "kind": "intune" | "ca",
  "template": { …the curated columns… }
}
```

`policy_json` is stored parsed (an object, not a string). For CA templates,
`conditions.users.excludeUsers` / `excludeGroups` are always `[]` (the source
instance's break-glass / exclusion-group GUIDs are stripped at export — the
receiving MSP adds its own), and named-location references are
`__PANOPTICA_LOCATION_<ISO>__` placeholders, never raw tenant GUIDs.

## How these files are produced (operator-run, on the reference instance)

There is **no** automatic prod-DB → repo path. Committing seed files is a
deliberate, reviewed act:

```bash
# 1. one-time hygiene: strip the wazuh ASR per-rule exclusion residue
node scripts/remove-asr-perrule-exclusion.js --apply
node scripts/remove-asr-perrule-exclusion.js            # confirms 0 changes

# 2. preview, then write the seed files
node scripts/export-seed-templates.js                   # dry run — review manifest
node scripts/export-seed-templates.js --apply           # writes intune/ + ca/
```

The export tool defaults to templates whose name starts with `Panoptica365`,
strips instance-specific columns, zeroes CA exemption lists, and refuses to
write any file whose `policy_json` contains an unexplained GUID unless you pass
`--allow-warnings` after reviewing each one.

## How they are seeded (automatic, at boot)

`src/db/seed-templates.js` (called from `src/server.js` `start()`) inserts every
file here **only when the target table is empty** — so existing installs are
never touched. CA `control_dimensions` are re-derived from `policy_json` by the
classifier at seed time, not trusted from the file. See that module's header for
the full contract.
