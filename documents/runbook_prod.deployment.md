# Production Deployment Runbook — Vestigian on Netcup

**Status (2026-09-30): executed.** This replaces the earlier Hetzner-era plan
(a migration that never ran) with what actually happened: VPS hardening,
Dokploy, Bunny, mail and the first admin account are live on a Netcup RS 4000
G12. Follow this in order to reproduce the setup on a fresh instance, or as a
reference for what's actually running. **Still open:** off-box backups
(`RESTIC_*`), the Bunny CrowdSec bouncer (a real Bunny-API bug, unresolved —
see §17), and a CORS wildcard on the API (see §18).

Placeholders to replace throughout: `<vps-ip>` / `<vps-ipv6>`, `<domain>`
(e.g. `vestigian.org`), `<github-user>/<repo>`, `<dokploy-app-id>` (Dokploy
appends a random suffix to your project name, e.g. `vestigian-4vgm6i` —
`docker compose ls` on the VPS shows the real one).

**2026-09-30 update:** the CORS-wildcard item below was root-caused and fixed.
`nuxt.config.ts`'s `security.corsHandler.origin` read
`process.env.NUXT_PUBLIC_SITE_URL` directly, which only resolves at `pnpm
build` time — the Dockerfile takes no such build arg, so it always baked in
as the `http://localhost:3000` fallback regardless of production's real env.
Fix: `docker/compose.prod.yml`'s `app` service now also sets
`NUXT_SECURITY_CORS_HANDLER_ORIGIN: ${SITE_URL}` — nuxt-security's own
`corsHandler` options live in `runtimeConfig.security`, which nitro
env-overrides at **container start** by its usual `NUXT_<PATH>` convention
(the same mechanism that already makes `NUXT_PUBLIC_SITE_URL` work). No
rebuild needed; takes effect on the next `docker compose up` / Dokploy
redeploy. Verify after deploying:

```bash
curl -sI -H "Origin: https://<domain>" "https://<domain>/api/health" | grep -i access-control-allow-origin
# expect: access-control-allow-origin: https://<domain>  (not *)
```

---

## 1. VPS baseline

Ubuntu 24.04 minimal cloud image, root, SSH keys already installed.

```bash
apt update && apt full-upgrade -y
apt install -y curl wget gnupg2 ca-certificates ufw unattended-upgrades needrestart
timedatectl set-timezone UTC          # correlates cleanly with Loki/Tempo/Prometheus later
hostnamectl set-hostname <domain>-prod
dpkg-reconfigure --priority=low unattended-upgrades
```

In `/etc/apt/apt.conf.d/50unattended-upgrades`, set:

```
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:00";
```

**This reboot is why §13's auto-heal script exists** — it restarts Docker,
which recreates Traefik with a new internal IP, silently breaking the
firewall rule that lets external traffic reach it.

## 2. Non-root user

```bash
adduser deploy
usermod -aG sudo deploy
mkdir -p /home/deploy/.ssh
cp /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh && chmod 600 /home/deploy/.ssh/authorized_keys
```

**Verify `ssh deploy@<vps-ip>` and `sudo whoami` in a second terminal before
closing the root session** — this is the one step that locks you out
permanently if skipped.

Then `/etc/ssh/sshd_config.d/99-hardening.conf`:

```
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
AllowUsers deploy
MaxAuthTries 3
LoginGraceTime 20
ClientAliveInterval 300
ClientAliveCountMax 2
```

```bash
sshd -t && systemctl reload ssh
```

Verify root login is refused and `deploy` still works, **in a new terminal**,
before closing the original session.

## 3. Kernel hardening

`/etc/sysctl.d/99-hardening.conf`:

```
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.icmp_echo_ignore_broadcasts = 1
net.ipv4.tcp_syncookies = 1
net.ipv6.conf.all.accept_redirects = 0
net.ipv6.conf.all.accept_source_route = 0
kernel.randomize_va_space = 2
fs.protected_hardlinks = 1
fs.protected_symlinks = 1
```

```bash
sysctl --system
```

Don't touch `net.ipv4.ip_forward` — Docker needs it and sets it itself.

## 4. Firewall — ufw, and the Docker gotcha

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

**Docker bypasses ufw by default** — published container ports go through
Docker's own iptables chain, ahead of ufw's rules. Fix with `ufw-docker`
(review the script before running, same as any curl-to-root install):

```bash
curl -fsSL https://github.com/chaifeng/ufw-docker/raw/master/ufw-docker -o /tmp/ufw-docker
less /tmp/ufw-docker
install -m 755 /tmp/ufw-docker /usr/local/sbin/ufw-docker
ufw-docker install
systemctl restart ufw
```

This alone is **not enough** — see §13, which is the actual, tested fix for
Traefik specifically (Dokploy's own container, not something this repo's
compose file manages).

## 5. Docker Engine

```bash
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | tee /etc/apt/sources.list.d/docker.list
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
usermod -aG docker deploy
```

`/etc/docker/daemon.json` — the default `json-file` log driver has no cap:

```json
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }
```

```bash
systemctl restart docker
```

## 6. CrowdSec (SSH protection)

```bash
curl -s https://install.crowdsec.net | less   # review first
curl -s https://install.crowdsec.net | sudo sh
apt install -y crowdsec crowdsec-firewall-bouncer-iptables
```

**The install script only adds the APT repo — it does not install the
`crowdsec` package itself.** `apt install -y crowdsec` is a separate,
required step, or `cscli` won't exist.

```bash
cscli collections install crowdsecurity/sshd
cscli collections install crowdsecurity/linux
systemctl enable --now crowdsec crowdsec-firewall-bouncer
```

## 7. Dokploy

```bash
curl -sSL https://dokploy.com/install.sh | less   # review first
curl -sSL https://dokploy.com/install.sh | sh
```

Dashboard on port 3000, **deliberately not opened in ufw** — reach it via
tunnel:

```bash
ssh -N -L 3000:localhost:3000 -L 3001:localhost:3001 deploy@<vps-ip>
```

## 8. DNS (Hostinger)

hPanel → Domains → **DNS** (not "DNS Zone Editor" — Hostinger renamed it) →
your domain → **DNS records**.

| Type           | Name            | Value              | Purpose                          |
| -------------- | --------------- | ------------------ | -------------------------------- |
| A              | `origin`        | `<vps-ip>`         | Bunny's origin for the main site |
| AAAA           | `origin`        | `<vps-ipv6>`       | same, IPv6                       |
| A              | `images-origin` | `<vps-ip>`         | Bunny's origin for imgproxy      |
| AAAA           | `images-origin` | `<vps-ipv6>`       | same, IPv6                       |
| CNAME or ALIAS | `@` (apex)      | `<zone>.b-cdn.net` | public hostname, via Bunny       |

**Apex can't take a plain CNAME** (RFC restriction) — Hostinger's fix is
picking **CNAME** as the type with `@` as the name; it auto-classifies as an
ALIAS. **If Hostinger has an existing A record at `@`** (default parking
page), delete it first — ALIAS and A can't coexist on the same name.

## 9. Bunny — site pull zone

1. **CDN → Add Pull Zone**. Origin Type: **Origin URL** = `https://origin.<domain>`
2. **Forward Host Header: ON** — this is what lets the app see the real
   public hostname (for `SITE_HOST`, CSP, cookies) even though Bunny connects
   to `origin.<domain>`, not the public name.
3. **Hostnames tab** → add `<domain>` → once the apex ALIAS resolves, click
   **Verify & Activate SSL** → toggle **Force SSL**.
4. **Caching tab → "Strip response cookies" → OFF.** Default-on on some
   zones; if left on, Bunny silently strips every `Set-Cookie` header from
   origin responses — login works server-side (200, correct session cookie
   in the origin's own response) but nothing ever reaches the browser. This
   cost an entire evening to find; check this **first** if login "does
   nothing."
5. **Origin lock — a secret header, not an IP allowlist.** Bunny's edge IP
   list changes over time and would need re-syncing monthly; a shared secret
   avoids that entirely. **Edge Rules → Add Edge Rule**:
   - Action: Set Request Header, Name `X-Origin-Key`, Value: `openssl rand -hex 32`
   - Condition: Request URL, Match Any, `*`

   In `docker/compose.prod.yml`, both app routers require this header
   (`Header('X-Origin-Key', '${ORIGIN_KEY:?...}')`) — anything reaching
   Traefik without it gets a 404, so `x-real-ip` trust
   (`NUXT_BEHIND_TRUSTED_PROXY=true`) can't be spoofed by connecting to the
   origin directly. Set `ORIGIN_KEY` in Dokploy's env to the same value.

## 10. Bunny — image storage

1. **Storage → Add Storage Zone.** Region: closest to the VPS (Frankfurt for
   a Nuremberg-area VPS) — Falkenstein is a CDN PoP name, not an actual
   storage region, despite older docs suggesting it.
2. **Enable S3 compatibility at creation** — cannot be added to an existing
   zone.
3. **Access tab**: `BUNNY_S3_ENDPOINT` = the API endpoint shown;
   `BUNNY_ACCESS_KEY_ID` = the storage zone's **name**; `BUNNY_SECRET_ACCESS_KEY`
   = the storage zone's **Password**. These aren't a separate generated pair —
   Bunny's S3 layer reuses the native storage credentials directly.
4. **CDN → Add Pull Zone** for images. Origin Type: **Origin URL** =
   `https://images-origin.<domain>` (not the storage zone directly — see
   below). **Forward Host Header: OFF** this time (opposite of §9) — imgproxy
   doesn't care what public hostname a visitor used.
5. **Why not "Bunny Storage Zone" as the origin type:** the app never serves
   raw stored files. `server/api/images/[id]/[preset].get.ts` redirects to a
   **signed imgproxy URL**, built from `IMAGE_BASE_URL` in
   `server/utils/images.ts`. That URL only resolves correctly if the pull
   zone's origin is imgproxy itself (doing the signing/resizing), not the raw
   storage bucket. `IMAGE_HOST=images-origin.<domain>` is what Traefik's
   `images` router matches on.
6. Migrating existing local images: Bunny's S3 API is public preview and not
   trusted for bulk transfer — use `rclone` instead, on the VPS (datacenter
   speed both ways):
   ```bash
   rclone config create bunny s3 provider=Other \
     access_key_id=<storage-zone-name> secret_access_key=<storage-zone-password> \
     endpoint=<BUNNY_S3_ENDPOINT>
   rclone sync minio:vestigian bunny:<storage-zone-name> --progress --transfers 16 --checksum
   rclone size minio:vestigian && rclone size bunny:<storage-zone-name>   # must match
   ```
   `pnpm images:reconcile` only checks `site_images`, not
   `column_relief_plates` — every `column-reliefs/*` object will show as a
   false-positive "orphan." Expected, not a bug.

## 11. GHCR — case and visibility

`.github/workflows/deploy.yml` tags the image as `ghcr.io/${{ github.repository }}`.
**GitHub preserves registration case, but OCI image references must be
lowercase** — this fails the whole build before anything publishes. Fix
(already applied in this repo): a `lowercase repository name` step using
`${GITHUB_REPOSITORY,,}`, referenced in every tag instead of the raw
`github.repository`.

Make the GHCR package **public** (Package settings → Danger Zone → Change
visibility) rather than storing a registry credential in Dokploy — simpler,
and no `write:packages`-scoped token sitting on the VPS.

## 12. Deploying via Dokploy

**Use the plain "Git" provider, not "GitHub App."** The GitHub App flow needs
a publicly reachable webhook callback, which conflicts with keeping Dokploy's
dashboard off the public internet — it fails with "Hook url is not supported
because it isn't reachable." Git provider needs only an HTTPS clone URL, no
callback.

Dokploy → Project → add Compose service:

- Provider: **Git**, HTTPS URL: `https://github.com/<github-user>/<repo>.git`, branch `main`
- Compose Path: `docker/compose.prod.yml`
- **Environment tab**: paste every `KEY=value` the compose file references
  (grep it: `grep -oE '\$\{[A-Z_]+' docker/compose.prod.yml | sort -u`) —
  Dokploy writes these to a `.env` file next to the compose file; Compose
  picks it up automatically, this isn't Dokploy-specific magic.

**`pull_policy: always` is set on the `app` service specifically** — Dokploy's
real deploy command is `up -d --build --remove-orphans`; `--build` only
rebuilds services with a `build:` directive (`bunny-bouncer`, `backup`), never
re-checking the registry for an `image:`-only service. Without this, every
deploy silently reused whatever `ghcr.io/.../vestigian:latest` was first
pulled, regardless of new pushes — a real bug that stayed invisible for hours
because every earlier fix that night only touched the compose file itself
(which Dokploy does correctly re-clone from git every time), never the app's
actual code. **Don't add `pull_policy: always` to other services** —
`postgres`/`valkey` use pinned version tags where it's a no-op, and forcing a
pull on every deploy for a stateful service risks an unplanned image upgrade
as a side effect of pushing unrelated code.

**Webhook auto-deploy doesn't work here, by design.** Dokploy's webhook URL
defaults to `localhost:3000`, meaningful only inside the SSH tunnel that
generated it — a GitHub-hosted runner can't reach it, and opening it up would
undo keeping the dashboard off the public internet. `deploy.yml` only builds
and publishes; deploy is a manual click in Dokploy after each push, which
also matches this repo's existing philosophy of `release.yml` requiring
`workflow_dispatch` rather than auto-releasing.

**The app and imgproxy services must join Dokploy's own network explicitly:**

```yaml
networks:
  app:
    networks: [default, dokploy-network]
  imgproxy:
    networks: [default, dokploy-network]
networks:
  default:
    name: <dokploy-app-id>_default # get the real name: docker network ls
    external: true
  dokploy-network:
    external: true
```

Without this, Traefik discovers the service's labels fine (a Docker API
read) but has no network path to actually reach the container — surfaces as
a permanently healthy container behind a router returning 503 "no available
server." **Don't set a custom `name:` on the default network** — Compose's
own project-scoped name (from the `-p` flag Dokploy passes) is what
already-running containers expect; forcing a name broke every one of them at
once.

## 13. Traefik firewall — the recurring one

Traefik is Dokploy's own container, outside this repo's compose file, so
`ufw-docker` (§4) never covers it. Its internal IP changes on every restart
(the 04:00 reboot from §1, a manual restart, a Dokploy platform update), and
the firewall rule pointing at the _old_ IP silently stops matching — this
was the single largest time sink of this whole deployment.

One-time immediate fix, get the current IP first:

```bash
sudo iptables -t nat -L DOCKER -n | grep -E "dpt:80 |dpt:443 "   # shows the real current target IP
ufw route allow proto tcp from any to <that-ip> port 80
ufw route allow proto tcp from any to <that-ip> port 443
```

**Permanent fix — self-healing, runs daily after the scheduled reboot:**

```bash
tee /usr/local/sbin/sync-traefik-firewall.sh > /dev/null <<'SCRIPT'
#!/bin/bash
set -euo pipefail
CURRENT_IP=$(iptables -t nat -L DOCKER -n | awk '/tcp dpt:443 to:/ {n=split($NF,a,":"); print a[2]; exit}')
[ -z "$CURRENT_IP" ] && exit 0
ufw route allow proto tcp from any to "$CURRENT_IP" port 80 || true
ufw route allow proto tcp from any to "$CURRENT_IP" port 443 || true
while read -r rule; do
  ip=$(echo "$rule" | grep -oP '(?<=-d )[0-9.]+(?=/32)')
  [ -n "$ip" ] && [ "$ip" != "$CURRENT_IP" ] && iptables ${rule/-A/-D}
done < <(iptables -S ufw-user-forward | grep -E -- '--dport (80|443) -j ACCEPT')
SCRIPT
chmod +x /usr/local/sbin/sync-traefik-firewall.sh
```

The stale-rule cleanup (the `while read` loop) matters: Docker reuses freed
IP addresses, and a leftover allow-rule for an old Traefik IP could
eventually authorize public access to some unrelated future container that
happens to get reassigned that same address.

```bash
tee /etc/systemd/system/sync-traefik-firewall.service > /dev/null <<'EOF'
[Unit]
Description=Keep the firewall pointed at Traefik's current internal IP
After=docker.service
Requires=docker.service
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/sync-traefik-firewall.sh
EOF
tee /etc/systemd/system/sync-traefik-firewall.timer > /dev/null <<'EOF'
[Unit]
Description=Run sync-traefik-firewall daily after the scheduled reboot
[Timer]
OnCalendar=*-*-* 04:15:00
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now sync-traefik-firewall.timer
```

Once daily (15 min after the reboot) is deliberate, not a compromise: the
only expected trigger is that reboot. A manual restart or platform update is
rare enough to fix by hand the same way, and running this only once a day
avoids the risk of a buggy unattended deletion routine causing a _new_,
harder-to-diagnose outage.

## 14. Database migration

```bash
# local: full dump, not pnpm db:snapshot (which excludes antiquity_* —
# correct for nightly backups, wrong for a one-time initial load)
pg_dump "$NUXT_DATABASE_URL" -Fc --no-owner --no-acl -f vestigian-full.dump
pg_restore --list vestigian-full.dump | wc -l   # plausibility check

rsync -avP vestigian-full.dump deploy@<vps-ip>:/tmp/   # apt install rsync first if missing

# on the VPS, restore into the already-running container — --clean --if-exists
# makes this safe against the schema the app's own startup migration already created
docker exec -i <postgres-container> pg_restore \
  --no-owner --no-acl --clean --if-exists \
  -U vestigian -d vestigian < /tmp/vestigian-full.dump
docker compose -f <compose-path> restart app   # reconnect cleanly, not against dropped/recreated objects
```

## 15. Basemap (PMTiles)

Production hard-codes `NUXT_PUBLIC_BASEMAP_PROVIDER: pmtiles` — the map is
blank without this.

```bash
# on the VPS, inside tmux (long-running, survives a dropped SSH session)
tmux new -s basemap
curl -L -o go-pmtiles.tar.gz https://github.com/protomaps/go-pmtiles/releases/download/v1.31.2/go-pmtiles_1.31.2_Linux_x86_64.tar.gz
tar -xzf go-pmtiles.tar.gz
./pmtiles extract https://build.protomaps.com/<YYYYMMDD>.pmtiles basemap.pmtiles --bbox=-12,22,48,60
rclone copyto basemap.pmtiles bunny:<images-storage-zone>/basemap.pmtiles --progress
rm basemap.pmtiles   # ~40GB extract, free the disk
```

Set `PMTILES_URL=https://<images-zone>.b-cdn.net/basemap.pmtiles` in Dokploy,
Deploy. **Env var changes need a redeploy** — Dokploy writes to `.env`, the
running container's environment is fixed at creation.

## 16. Mail — Brevo

Replaces Lettermint (operator's own choice). `server/utils/mail.ts`'s
`sendThroughBrevo` posts to `https://api.brevo.com/v3/smtp/email` with
`api-key` header — a different call shape than Lettermint's, already applied.

1. Brevo → **Settings → SMTP & API → API Keys** → generate → `MAIL_API_KEY`
2. Brevo → **Senders, Domains & Dedicated IPs → Domains** → add `<domain>` →
   note the DKIM and DMARC values shown (account-specific, copy exactly)
3. Hostinger DNS, in addition to §8's records:

   | Type  | Name               | Value                                              |
   | ----- | ------------------ | -------------------------------------------------- |
   | CNAME | `mail._domainkey`  | `b1.<domain-with-dashes>.dkim.brevo.com`           |
   | CNAME | `mail2._domainkey` | `b2.<domain-with-dashes>.dkim.brevo.com`           |
   | TXT   | `_dmarc`           | `v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com` |

   **Delete any existing `_dmarc` TXT record first** — only one is allowed
   per domain. Without DKIM/DMARC passing, Brevo won't deliver to
   Google/Yahoo/Microsoft at all (their 2024+ bulk-sender requirements).

4. Back in Brevo, click **Verify**/**Authenticate** on the domain.
5. `MAIL_FROM=<Name> <no-reply@<domain>>`, matching the verified sender exactly.

## 17. Alerting — Discord, not email or Telegram

Deliberately not email: this file is in a public repo, so a personal address
can't live in it. Telegram (also natively supported since Alertmanager v0.24)
was tried first and dropped only because of trouble with Telegram's own
account verification — not a config problem.

**Alertmanager's config parser does not expand `${VAR}` placeholders at
all** (upstream rejected adding it) — a bare `${ALERT_FROM}`-style value in
`alertmanager.yml` is read as that literal string, silently, with no startup
error. This is why the original email-based alerting never actually worked.
Fix: everything that isn't a live secret is a literal value in the file;
the one real secret (`webhook_url`) is file-backed via Compose's
environment-sourced secrets, native, no relay container:

```yaml
# compose.prod.yml
secrets:
  discord_webhook_url:
    environment: DISCORD_WEBHOOK_URL
services:
  alertmanager:
    secrets: [discord_webhook_url]
```

```yaml
# alertmanager.yml
receivers:
  - name: operator
    discord_configs:
      - webhook_url_file: '/run/secrets/discord_webhook_url'
        send_resolved: true
```

Discord → channel → Edit Channel → **Integrations → Webhooks → New Webhook**
→ copy URL → `DISCORD_WEBHOOK_URL` in Dokploy. No bot, no phone
verification, unlike Telegram.

Test:

```bash
docker exec <alertmanager-container> wget -qO- \
  --post-data='[{"labels":{"alertname":"test","severity":"warning"}}]' \
  --header='Content-Type: application/json' http://localhost:9093/api/v2/alerts
```

(image is minimal — no `curl` inside it, use `wget`. Port 9093 also isn't
published to the host, so this must run via `docker exec`, not directly.)

## 18. First admin account

**No in-app bootstrap path, by design** — an unauthenticated
role-escalation endpoint would be worse than one manual SQL statement.

1. Register normally, confirm the email.
2. ```bash
   docker exec -it <postgres-container> psql -U vestigian -d vestigian \
     -c "UPDATE users SET role = 'admin' WHERE email = '<your-email>';"
   ```
3. Reload the site — role is re-read from the DB on every request, no
   re-login needed.

**If login appears to do nothing (no session, `/admin` redirects to login):**
first suspect is §9's "Strip response cookies" setting on Bunny, not the app.
Confirmed with:

```bash
docker exec <app-container> node -e '
fetch("http://127.0.0.1:3000/api/auth/login", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "...", password: "..." }),
}).then((r) => console.log(r.status, r.headers.get("set-cookie")))'
```

If this (bypassing Traefik/Bunny entirely, straight to the app's own port)
shows a correct `Set-Cookie`, but the same request through
`https://<domain>` doesn't, the app is innocent — it's Bunny stripping it.

## 19. Still open

- **`RESTIC_*` backups.** Nightly dump still never leaves the box. Needs an
  off-site target (Hetzner Storage Box works cross-provider, or check
  Netcup's own storage product) — see `.claude/rules/deployment-and-releases.md`.
- **Bunny CrowdSec bouncer** (`docker/security/bunny-bouncer/`). Every manual,
  isolated API call to Bunny's `edgerules/addOrUpdate` succeeds — identical
  payload, identical credentials — but the automated poller consistently
  fails with a misleading `"Maximum 5 triggers are allowed per condition"`
  error, even from a cold container start with zero pre-existing state.
  Exponential backoff was added (`bouncer.mjs`) since the original code
  retried a failing call every 15s forever with no backoff, which is a real
  fix regardless of the root cause, but the underlying Bunny-side behavior is
  unresolved. Currently **stopped**
  (`docker stop <bouncer-container>`). Origin is still protected by §9's
  secret header regardless — this bouncer would only add automatic banning
  at Bunny's edge on top of that.
- ~~CORS wildcard~~ — fixed 2026-09-30, see §12's `NUXT_SECURITY_CORS_HANDLER_ORIGIN` note.
