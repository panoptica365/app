# Panoptica365 — Disaster Recovery Restore Procedure

**Last updated:** May 1, 2026

This document is the canonical "the server is gone, get me running again" runbook. It assumes you have:

- A nightly MySQL dump (cron job: `/opt/panoptica/scripts/mysql-backup.sh` at 02:00).
- A nightly snapshot of `/opt/panoptica` to your QNAP NAS (cron job: `/usr/local/sbin/panoptica_backup.sh` at 03:00).
- The QNAP itself replicating to a disconnected cloud account.
- A copy of the latest `panoptica-setup.sh` (this repo, root).

If any of those are missing or stale, you do not have backups — fix that first.

---

## Known DR gap (read this first)

Your /opt/panoptica NAS backup captures:

- `src/`, `locales/`, `public/`, `config/`, `scripts/`, `backups/`, `certs/`, `dev/`, `logs/`, `package.json`, `.env`, schema SQL files, etc.

It does **NOT** capture these system files because they live outside `/opt/panoptica`:

| Path | What it is | Recovery |
|---|---|---|
| `/usr/local/sbin/panoptica_backup.sh` | The script driving NAS backups | Recreate manually, OR copy to `/opt/panoptica/sysconfig/` as part of regular backup |
| `/etc/logrotate.d/panoptica_backup` | Log rotation for backup logs | Recreate manually |
| `/etc/cron.d/*` or root/user crontab entries | Schedules for the above | Recreate manually (commands listed below) |
| `/etc/samba/smb.conf` `[panoptica]` section | SMB share | `panoptica-setup.sh` regenerates this |
| `/etc/nginx/sites-available/panoptica` | nginx reverse proxy | `panoptica-setup.sh` regenerates this |
| `/etc/nginx/ssl/panoptica.{crt,key}` | Self-signed nginx TLS | `panoptica-setup.sh` regenerates this |
| `/opt/panoptica/certs/panoptica-graph.*` | Graph app-only cert | `panoptica-setup.sh` regenerates a NEW one |

**Recommendation (close this gap):** before each backup, copy the system files into a `/opt/panoptica/sysconfig/` folder so they end up on the NAS. Add this to `panoptica_backup.sh`:

```bash
mkdir -p /opt/panoptica/sysconfig
cp /usr/local/sbin/panoptica_backup.sh   /opt/panoptica/sysconfig/
cp /etc/logrotate.d/panoptica_backup     /opt/panoptica/sysconfig/
crontab -l > /opt/panoptica/sysconfig/user-crontab.txt
sudo crontab -l > /opt/panoptica/sysconfig/root-crontab.txt
```

---

## DR procedure (fresh Ubuntu 24.04 server)

### Phase 1: Base infrastructure (~10-15 minutes)

1. Spin up fresh Ubuntu Server 24.04.
2. Create your normal user account (e.g., `jacques`), give it sudo.
3. Copy `panoptica-setup.sh` to the server (e.g., via SCP or USB).
4. Run it:

   ```bash
   chmod +x panoptica-setup.sh
   sudo ./panoptica-setup.sh
   ```

5. Type `PROCEED` to confirm. Provide:
   - MySQL root password
   - MySQL `panoptica` user password — **MUST** match `DB_PASS` in your backed-up `.env`
   - Samba password
   - Server hostname (default: `panoptica.trilogiam.net`)

6. At the end, **note the new Graph cert thumbprint** — you'll need it.

### Phase 2: Restore data

7. **Mount the QNAP** (or your equivalent):

   ```bash
   sudo mkdir -p /mnt/qnap
   sudo mount -t cifs //qnap.local/panoptica-backups /mnt/qnap -o user=...,password=...
   ```

8. **Restore /opt/panoptica** from the latest snapshot:

   ```bash
   sudo rsync -avh --delete --exclude='.env.template' \
     /mnt/qnap/panoptica/latest/ /opt/panoptica/
   sudo chown -R jacques:jacques /opt/panoptica
   ```

   *Why `--exclude='.env.template'`:* The setup script just generated a fresh template with a new `SESSION_SECRET`. You probably want the live `.env` from backup, not the template anyway, so this is mostly defensive.

9. **Restore the MySQL database** from the latest dump:

   ```bash
   gunzip -c /mnt/qnap/panoptica/db/panoptica-latest.sql.gz | \
     mysql -u panoptica -p panoptica
   ```

   Verify:
   ```bash
   mysql -u panoptica -p panoptica -e "SELECT COUNT(*) FROM tenants;"
   ```

### Phase 3: Update the Graph cert

The setup script generated a **new** cert. You must choose:

**Option A — keep the new cert (recommended for true DR):**

10A. The restore in step 8 will have brought back `/opt/panoptica/certs/panoptica-graph.*` from backup, **overwriting** the new cert the script just made. Re-generate:

   ```bash
   # Re-run just the cert step manually:
   cd /opt/panoptica/certs
   openssl req -x509 -nodes -days 730 -newkey rsa:4096 \
     -keyout panoptica-graph.key -out panoptica-graph.crt \
     -subj "/CN=Panoptica365 Graph Service/O=Panoptica365" -batch
   openssl pkcs12 -export -out panoptica-graph.pfx \
     -inkey panoptica-graph.key -in panoptica-graph.crt \
     -name "Panoptica365 Graph Service" -passout pass:
   openssl x509 -in panoptica-graph.crt -outform DER -out panoptica-graph.cer
   openssl x509 -in panoptica-graph.crt -noout -fingerprint -sha1 \
     | sed 's/SHA1 Fingerprint=//' | tr -d ':' > panoptica-graph.thumbprint
   chmod 0600 panoptica-graph.pfx panoptica-graph.key
   chmod 0644 panoptica-graph.cer panoptica-graph.crt panoptica-graph.thumbprint
   chown jacques:jacques panoptica-graph.*
   cat panoptica-graph.thumbprint
   ```

11A. Upload `panoptica-graph.cer` to Entra: **Entra admin centre → App registrations → Panoptica → Certificates & secrets → Certificates → Upload certificate**.

12A. Update `/opt/panoptica/.env`:

   ```
   GRAPH_CERT_THUMBPRINT=<new thumbprint from cat above>
   ```

13A. Delete the old cert from Entra to revoke it.

**Option B — keep the old cert (faster, less secure):**

10B. Just leave the restored cert in place. Skip cert upload.
11B. The thumbprint in the restored `.env` already matches the restored cert. Done.
12B. ⚠ This means if the old server's filesystem was compromised, the attacker still has a valid cert paired to your Entra app. Only use this option if you know the old server was lost cleanly (hardware failure, not breach).

### Phase 4: Node deps + start

14. Install npm dependencies:

   ```bash
   cd /opt/panoptica
   export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"
   npm install
   ```

15. Start the app:

   ```bash
   pm2 start src/server.js --name panoptica
   pm2 save
   ```

16. Verify:

   ```bash
   pm2 list
   curl -k https://localhost/api/health
   ```

### Phase 5: Re-create cron jobs (the manual gap)

17. **User crontab** (as the panoptica user):

   ```bash
   crontab -e
   # Add:
   0 2 * * * DB_PASS="<your MySQL panoptica password>" /opt/panoptica/scripts/mysql-backup.sh
   ```

18. **Root crontab** (`sudo crontab -e`):

   ```bash
   0 3 * * * /usr/local/sbin/panoptica_backup.sh >> /var/log/panoptica_backup.log 2>&1
   ```

19. **Restore /usr/local/sbin/panoptica_backup.sh** from your `/opt/panoptica/sysconfig/` stash (assuming you took the recommendation at the top of this doc), or recreate from your notes:

   ```bash
   sudo cp /opt/panoptica/sysconfig/panoptica_backup.sh /usr/local/sbin/
   sudo chmod +x /usr/local/sbin/panoptica_backup.sh
   ```

20. **Restore /etc/logrotate.d/panoptica_backup**:

   ```bash
   sudo cp /opt/panoptica/sysconfig/panoptica_backup /etc/logrotate.d/
   ```

21. Test the backup pipeline manually before trusting cron:

   ```bash
   sudo /usr/local/sbin/panoptica_backup.sh
   bash /opt/panoptica/scripts/mysql-backup.sh
   ```

### Phase 6: Network finalization

22. **Static IP**: System Settings → Network → IPv4 → Manual.
23. **DNS A record**: `panoptica.trilogiam.net` → static IP. (Cloudflare or wherever you host DNS.)
24. **Mac SMB mount**: Finder → Cmd+K → `smb://panoptica.trilogiam.net/panoptica` (user: `jacques`).
25. **Hyper-V checkpoint** the new VM as a clean baseline.

### Phase 7: Smoke tests

Browse to `https://panoptica.trilogiam.net/` and verify:

- [ ] Login with Entra works (you land on dashboard, not a 500)
- [ ] Tenant list populates from restored DB
- [ ] `/api/health` returns 200
- [ ] At least one tenant's secureScore reads cleanly (proves Graph cert works)
- [ ] Open SYSTEM → Audit Log; recent rows from before the restore are present
- [ ] Trigger a manual evaluator run on one tenant; verify a Daily Activity counter ticks
- [ ] One round of Phase B Security Settings reads (proves pwsh + cert + EXO module all wired)
- [ ] Restart pm2 and confirm sessions persist (express-mysql-session in the DB)

If any smoke test fails, **don't delete the old server VM yet** — debug from the new install with the old still around as reference.

---

## Recovery time objective (rough)

| Phase | Time |
|---|---|
| Base infrastructure (script run) | 10-15 min |
| /opt/panoptica restore from NAS | 5-15 min depending on size |
| MySQL restore | 2-10 min depending on dump size |
| Cert + Entra upload + .env update | 5 min |
| npm install + pm2 start | 5 min |
| Cron + sysconfig restore | 5 min |
| Smoke tests | 10 min |
| **Total** | **~45-70 minutes** |

This is the floor, assuming you have all backups intact and DNS propagation isn't fighting you.

---

## What this procedure does NOT cover

- **Customer tenant onboarding state.** Customer tenants don't store anything on the old server beyond what's in the DB; the cert + app registration in Entra is what authenticates Graph calls. As long as the cert is valid (Phase 3) and the panoptica app registration in Trilogiam's Entra still has Exchange Administrator role in each customer tenant, you're fine.
- **In-flight work.** Anything actively running at the moment of failure (an evaluation cycle, a digest send) is lost. The next cron tick recovers.
- **Email queue.** If SMTP2GO had pending sends, those are stateless on Panoptica's side — SMTP2GO retries based on its own queue.
- **Hyper-V host config.** This script restores the Panoptica VM only, not the host hypervisor.

---

## Test the DR procedure

Don't wait for a real disaster. Once a quarter:

1. Spin up a throwaway Ubuntu VM.
2. Run this whole procedure end-to-end.
3. Confirm smoke tests pass.
4. Note any drift from the doc, update the doc.
5. Tear down the throwaway VM.

The first time you run a DR procedure should not be when the server is on fire.
