# RELEASING.md — panoptica/app ship runbook

**Audience:** Claude sessions shipping a release of `panoptica/app`.
**Read this in full before running any git command for a release.**

Scope: app releases only (`ghcr.io/panoptica365/app`). Installer
(`panoptica365/installer`) and license-server (`license.panoptica365.com`)
have their own ship rituals.

---

## CARDINAL RULES — never violate

1. **Edit files via SMB on Mac. Git ops ONLY on `Panoptica365-Prod`.**
   The Mac path `/Users/jacques/panoptica/` IS the Prod path `/opt/panoptica/`
   via SMB mount. Edit from Mac. `git commit`, `git tag`, `git push`,
   `git reset` MUST be run in an SSH session on Prod. Reason: macOS writes
   `._*` AppleDouble sidecars into `.git/objects/` over SMB → silent git
   corruption.

2. **Delete AppleDouble sidecars before every git operation.**
   ```bash
   find . -name '._*' -delete
   ```
   Run this in BOTH `/opt/panoptica/` AND any other repo you touch
   (`/opt/panoptica/panoptica365-installer/`, etc.) before `git add`.

3. **VERIFY the commit landed before tagging.**
   ```bash
   git log --oneline -1
   ```
   Must show the SHA + commit subject you just wrote. If it shows the
   previous commit, your commit silently failed (missing git config,
   heredoc syntax, hook rejection). DO NOT tag — diagnose first. A tag
   on the wrong commit ships wrong code, invisible until pulled.

4. **`git tag <name>` silently fails if the tag already exists.**
   The error prints to stderr but the next command runs anyway. So
   `git push --tags` happily pushes nothing new. Always check:
   ```bash
   git tag --list 'vX.Y.Z'   # must be empty BEFORE tagging
   ```
   If the tag already exists at the wrong commit, bump the version
   instead of force-moving the tag (existing pulls would orphan).

5. **Push with `--tags`. Without it, GH Actions does NOT fire.**
   ```bash
   git push origin main --tags
   ```

6. **Wait for GH Actions GREEN before testing.**
   `docker compose pull` returns instantly with the cached image if
   GHCR hasn't updated yet. You'll think you tested the new code but
   you actually ran the old one. Check:
   ```
   https://github.com/panoptica365/app/actions
   ```
   Wait for the green checkmark on the tag's build (~2-3 min typical).

7. **NEVER `git push --force` or `git tag -f`.** Customers may have
   already pulled the published image. Force-moving a tag orphans
   their pull. Always bump the version instead.

8. **NEVER `--no-verify` on commits.** If a hook fails, fix it.

---

## Pre-flight — what to bump

Every release MUST touch all of these:

| File | Change |
| --- | --- |
| `VERSION` | Bump to new `0.1.X` (or `0.X.0` for breaking changes) |
| `WHATS-NEW.md` | Add `## Version 0.1.X — YYYY-MM-DD` at the top |
| `WHATS-NEW.fr.md` | Same entry, French translation (Canadian fr-CA) |
| `WHATS-NEW.es.md` | Same entry, Spanish translation (neutral es) |

**i18n parity is mandatory.** All 3 locales get the same release entry.
Missing locale = blank What's New modal section for that user.

### WHATS-NEW.md entry format

```markdown
## Version 0.1.X — YYYY-MM-DD

### Short title for the change

1–3 paragraph plain-prose explanation. WHO is affected, WHAT changed,
WHY it changed. Avoid implementation jargon — the audience is the MSP
operator, not a developer. Code paths in `backticks`. Filenames in
`backticks`. No emoji unless explicitly requested.

### Another change (if multiple)

Same format.

---
```

Always end with `---` separator before the next version's section.

For locale parity: translate the body but keep version number + date
identical. French uses `## Version 0.1.X — YYYY-MM-DD`; Spanish uses
`## Versión 0.1.X — YYYY-MM-DD` (note the accent).

---

## Ship sequence

Run ALL commands on `Panoptica365-Prod` via SSH. Substitute `0.1.X`
with the actual version.

```bash
cd /opt/panoptica
find . -name '._*' -delete

# 1. Sanity check
git status
git tag --list 'v0.1.X'        # MUST be empty

# 2. Stage exactly the files you changed (no `git add -A` — sweeps
#    .env.bak and other secrets). Always include the 4 mandatory files:
git add VERSION WHATS-NEW.md WHATS-NEW.fr.md WHATS-NEW.es.md \
        <your-other-changed-files>

# 3. Commit with heredoc (preserves formatting)
git commit -m "$(cat <<'EOF'
v0.1.X — one-line subject describing the change

Multi-paragraph body explaining WHAT changed and WHY. Reference the
relevant files, modules, or design decisions. Future-you will read
this in git log.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"

# 4. VERIFY the commit landed (CARDINAL RULE #3)
git log --oneline -1
#   Top line MUST show new SHA + "v0.1.X — one-line subject..."
#   If it shows the previous commit, STOP and diagnose.

# 5. Tag
git tag v0.1.X

# 6. Push commit + tag
git push origin main --tags
```

After push: open `https://github.com/panoptica365/app/actions` in browser.
Wait for green checkmark on the `v0.1.X` workflow run (~2-3 min).

---

## Verify the release landed

Three independent checks. Do all three before declaring done.

### 1. GitHub
```bash
git ls-remote --tags origin | grep v0.1.X
```
Should show the tag's SHA matching your local `git log -1`.

### 2. GH Actions
Open `https://github.com/panoptica365/app/actions`. Most recent run for
the `v0.1.X` tag must be green ✓. If red ✗, click in for the error
and fix forward (don't move the tag).

### 3. GHCR (the actual artifact customers pull)
On any box with Docker:
```bash
docker pull ghcr.io/panoptica365/app:v0.1.X
docker image inspect ghcr.io/panoptica365/app:v0.1.X \
  --format '{{.Created}} {{index .RepoDigests 0}}'
```
The `Created` timestamp should be within the last few minutes. Also
verify `:latest` got re-tagged:
```bash
docker pull ghcr.io/panoptica365/app:latest
docker image inspect ghcr.io/panoptica365/app:latest \
  --format '{{.Created}}'
```
Should match `:v0.1.X`.

---

## When to test on P365-Test

NOT every release. Reserve P365-Test fresh-install rehearsals for:

- **Wizard changes** (any file under `src/lib/setup/` or `public/js/setup.js`)
- **Installer changes** (handled in `panoptica365-installer` repo, separate ship)
- **Schema migrations** (changes to `src/db/database.js` or `src/db/schema.sql`)
- **License-validation changes** (anything in `src/lib/license/`)
- **Major version bumps** (0.X.0 → 0.Y.0)

For routine feature work (new alert types, UI polish, new API endpoints
that don't touch boot path): **Trilogiam (production) eats its own dogfood**.
A regression there surfaces within hours of upgrade, no rehearsal needed.

### P365-Test test sequence (when needed)
```bash
# On P365-Test:
sudo bash -c 'cd /opt/panoptica365 && docker compose pull && docker compose up -d'
sudo docker logs panoptica-app --tail=50
# Then walk whatever flow you changed in browser
```

For TRULY fresh-install validation (after installer/wizard changes):
```bash
# Revert P365-Test to base snapshot first, then:
curl -sSL https://install.panoptica365.com/run | sudo bash
# Or with --reinstall on a previously-installed box:
curl -sSL https://install.panoptica365.com/run | sudo bash -s -- --reinstall
```

---

## Common failure modes — diagnose by exact symptom

### "Author identity unknown" on `git commit`
The user running git has no `user.name` / `user.email` set.
Fix (Jacques must run; you cannot per project rules):
```bash
git config --global user.name  "Jacques Sauvé"
git config --global user.email "jacques@trilogiam.ca"
```
Then re-stage (still staged from before) + re-commit.

### `git tag` silently fails, push says "Everything up-to-date"
Tag already exists at a different commit. CARDINAL RULE #4.
**Don't force-move the tag.** Bump to the next version instead.
Move the WHATS-NEW entries (and any code changes that hadn't shipped
yet) into the new version's section. See v0.1.19 in WHATS-NEW.md for
a real example — that whole version exists because v0.1.18's tag was
already at the wrong commit.

### `git push` rejected — branch behind
Someone (Jacques, another session) pushed since your last pull.
```bash
git pull --rebase origin main
# Resolve any conflicts, then re-push
git push origin main --tags
```

### GH Actions build fails on a tag
Click into the failed run. Common causes:
- `npm test` failing (a new code change broke a test)
- Dockerfile issue (missing dependency)
- GHCR auth issue (rare, usually resolves on retry)

**Fix forward:** make a new commit with the fix, push, GH Actions
re-runs on the branch. The tag remains where it was; you'll either
(a) move the tag with `--force` only if you're SURE no one pulled yet
(unsafe — don't), or (b) bump to the next version and push that tag.
Prefer (b).

### App container fails healthcheck after upgrade
```bash
sudo docker logs panoptica-app --tail=80
```
Top suspects:
- Missing required env var (a new release expects a new `.env` line
  that wasn't added). Customer .env needs updating.
- Schema migration that errored (check `[DB]` lines in log)
- License validation refused (check `[license]` lines)

### `docker compose` says `no such service: <name>`
The compose service name is `panoptica-app`, `panoptica-db`,
`panoptica-proxy` — NOT `app`, `db`, `proxy`. Easy to forget. Or use
container names directly with `docker logs <name>`, `docker restart <name>`.

### Setup wizard appears after upgrade on an established install
The `setup-completed-once.flag` file is missing under
`data/state/`. v0.1.8+ writes it retroactively if a JWT-shaped
`LICENSE_TOKEN` is found in `.env`. If it didn't get written:
```bash
sudo touch /opt/panoptica365/data/state/setup-completed-once.flag
sudo docker compose restart panoptica-app
```

---

## What CAN'T be done casually

Slow down and design before shipping these:

- **DB schema with destructive changes** (`DROP COLUMN`, `RENAME`):
  existing installs need a forward migration. Schema is applied
  idempotently from `src/db/schema.sql` — additive changes (`ADD
  COLUMN`, `CREATE TABLE`) just work; destructive ones need code in
  the entrypoint to handle the migration cleanly.
- **Removing or renaming an `.env` variable** the app reads: customer
  installs won't notice the missing var, then crash at runtime. Either
  keep backward compat (read both old and new name, log a deprecation
  warning) or document in WHATS-NEW that the customer must edit `.env`
  during upgrade.
- **Wizard step changes**: existing installs are protected by
  `setup-completed-once.flag`, but new installs and `--reinstall`
  exercise the new flow. Test both.
- **License-server JWT claim changes**: server and client must ship
  together. License-server lives in a SEPARATE codebase on `Azure-VM`.
- **Anything that crosses sessions a customer might skip**: a customer
  on v0.1.19 might upgrade directly to v0.5.0 next month. Boot-time
  migrations must cover the gap. Don't assume sequential upgrades.

---

## Environment reference

Every command in a chat with Jacques must be prefixed with which box:

| Name | IP | Role |
| --- | --- | --- |
| **Panoptica365-Prod** | 192.168.60.10 | App source repo. ALL git ops happen here. Trilogiam's production install. |
| **License-DEV** | 192.168.60.75 | License-server source + dev environment. |
| **P365-Test** | 192.168.60.70 | Rehearsal box for fresh-install / installer / wizard tests. |
| **Azure-VM** | 4.239.120.253 | Production license server at `license.panoptica365.com`. |

Use the names verbatim. "On `Panoptica365-Prod`:" — never "on the
production VM" or "the server". Jacques needs to know which terminal
to type into.

---

## TL;DR ship checklist

Copy this into your scratchpad when shipping:

- [ ] Bump `VERSION`
- [ ] Add entry to `WHATS-NEW.md` (English)
- [ ] Translate entry to `WHATS-NEW.fr.md` (Canadian French)
- [ ] Translate entry to `WHATS-NEW.es.md` (neutral Spanish)
- [ ] `find . -name '._*' -delete` on Prod
- [ ] `git tag --list 'vX.Y.Z'` → MUST be empty
- [ ] `git add` specific files (no `-A`)
- [ ] `git commit` with heredoc message
- [ ] `git log --oneline -1` → verify SHA + subject
- [ ] `git tag vX.Y.Z`
- [ ] `git push origin main --tags`
- [ ] Wait for GH Actions green ✓ (~2-3 min)
- [ ] `docker pull` + `docker image inspect` to verify GHCR
- [ ] Test on Trilogiam (or P365-Test if wizard/installer/schema/license touched)
