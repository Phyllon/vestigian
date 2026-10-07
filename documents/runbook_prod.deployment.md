# Production Deployment Runbook — Vestigian on Netcup

**Status (2026-09-30): executed.** VPS hardening, Dokploy, Bunny, mail and the
first admin account are live on a Netcup RS 4000 G12. Follow this in order to
reproduce the setup on a fresh instance, or as a reference for what's actually
running. **Still open — see §19:** off-box backups (§20), the hillshade mirror
(§15a), the Bunny CrowdSec bouncer (rewritten 2026-10-03, not yet run against live Bunny), and the
CrowdSec community-sharing decision.

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

Two behaviours that look like failures and are not (confirmed against a
production build, 2026-10-02): a request **without** an `Origin` header always
answers `access-control-allow-origin: *` (that is h3's rule, and browsers send no
`Origin` on a same-origin GET); and a request from any origin other than
`SITE_URL` — `https://www.<domain>`, `http://<domain>`, `null`, a lookalike
subdomain — gets **no** `access-control-allow-origin` at all. Test with the
`Origin` header set, as above.

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
# makes this safe against tables that already exist (a restored dump is the schema at
# that moment; later migrations are applied by the `migrate` service, §14a)
docker exec -i <postgres-container> pg_restore \
  --no-owner --no-acl --clean --if-exists \
  -U vestigian -d vestigian < /tmp/vestigian-full.dump
docker compose -f <compose-path> restart app   # reconnect cleanly, not against dropped/recreated objects
```

## 14a. Schema migrations — the `migrate` service

**Every deploy applies pending migrations itself.** `docker/compose.prod.yml` has a
one-shot `migrate` service running the same image as the app: it executes
`.output/migrate.mjs` (drizzle's migrator, bundled by `pnpm build:migrate` in the
Dockerfile) against `server/database/migrations`, applies whatever the journal lists that
`drizzle.__drizzle_migrations` does not hold yet, and exits. `app` has
`depends_on: migrate: service_completed_successfully`, so:

- a release that adds a table needs **no manual step** — Dokploy → Deploy is enough, and the
  log of the `migrate` container says `Migrations applied.`;
- a migration that fails leaves the previous `app` container serving (Compose does not
  recreate it) and Dokploy shows the deploy as failed — read the `migrate` container's log;
- migrations must stay **additive and backwards-compatible** (new tables, new nullable
  columns, new indexes): the old app keeps running against the new schema until the new one
  is up. A destructive change needs two releases.

_History:_ before this service existed nothing ran migrations in production (the runtime
image had no migrations folder and no migrator), and the first reference-layers release
logged `relation "antiquity_hillforts" does not exist`. The service was added then, and the
manual route below remains the fallback.

**Manual fallback** — if the `migrate` service itself cannot run (an image without it, an
emergency), apply the SQL by hand. The tracking rows matter: Drizzle's record is
`drizzle.__drizzle_migrations` (SHA-256 of each `.sql` file and the journal's `when`), and
inserting them keeps the automatic service consistent afterwards.

```bash
# 1. VPS — what does production already have? The newest created_at is the cut-off.
docker exec <postgres-container> psql -U vestigian -d vestigian -At -c \
  "SELECT max(created_at) FROM drizzle.__drizzle_migrations"
#   → e.g. 1789328264139 (0029). If the schema "drizzle" does not exist at all, stop and
#   look: production was not built from a dump of a migrated database.

# 2. Local — one SQL file with every migration newer than that, plus its tracking row.
LAST=1789328264139      # the value from step 1
{
  echo 'BEGIN;'
  jq -r --argjson last "$LAST" '.entries[] | select(.when > $last) | "\(.tag) \(.when)"' \
    server/database/migrations/meta/_journal.json |
  while read -r tag when; do
    file="server/database/migrations/$tag.sql"
    cat "$file"; echo
    echo "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('$(sha256sum "$file" | cut -d' ' -f1)', $when);"
  done
  echo 'COMMIT;'
} > pending-migrations.sql
grep -c "^CREATE TABLE" pending-migrations.sql      # 6 for 0030 + 0031
rsync -avP pending-migrations.sql deploy@<vps-ip>:/tmp/

# 3. VPS — apply it. One transaction: a failure leaves the database untouched.
docker exec -i <postgres-container> psql -U vestigian -d vestigian \
  -v ON_ERROR_STOP=1 < /tmp/pending-migrations.sql
```

_Rehearsed 6 Oct 2026 on a scratch copy of the dev database with the six tables, the three
enums and the two tracking rows removed. Both routes: the generated file above applied
cleanly with tracking rows identical to the migrator's own; and the bundled `migrate.mjs`,
run from an empty directory containing only it and the migrations folder (no
`node_modules`), applied `0030`/`0031` on the first run, did nothing on the second, and
exits non-zero without `NUXT_DATABASE_URL`._

## 15. Basemap (PMTiles)

Production hard-codes `NUXT_PUBLIC_BASEMAP_PROVIDER: pmtiles` — the map is
blank without this.

**Serve the archives from a pull zone whose origin is the storage zone — not
the images pull zone of §10.** The images pull zone's origin is imgproxy
(`images-origin.<domain>`), which answers any path it cannot parse with
`404 Invalid URL`. A `.pmtiles` file uploaded to the storage zone is therefore
invisible through it: only byte ranges that happened to be cached earlier come
back (`206`, `cdn-cache: HIT`), and every other range is a 404 on a cache miss
— the map shows holes. Found 2026-10-03 by requesting `basemap.pmtiles` at
offsets from 20 KB to 40 GB: only the first ~MB answered. Make a second pull
zone first:

1. **CDN → Add Pull Zone**, name it e.g. `<maps-zone>`. Origin Type: **Storage
   Zone**, select the storage zone of §10 (not Origin URL).
2. Headers → enable **CORS** (the browser reads the archive cross-origin).
3. Caching → turn on cache slicing / large-file optimisation if offered; the
   archives are tens of GB read by range.
4. Check a _deep_ range, not just the start — the start can be served from an
   old cache entry while the origin is broken:
   ```bash
   curl -sI -H "Origin: https://<domain>" -H "Range: bytes=5000000000-5000016383" \
     https://<maps-zone>.b-cdn.net/basemap.pmtiles | grep -i -E "^HTTP|content-range|access-control"
   # expect HTTP/2 206 and an allow-origin header
   ```

`<images-zone>` was used for these URLs before; it is now `<maps-zone>`
everywhere in §15 and §15a. Use a **dated object name** for a replacement
archive (`basemap-YYYYMMDD.pmtiles`): the pull zone ignores query strings in
its cache key, so `?v=…` does not bust anything.

```bash
# on the VPS, inside tmux (long-running, survives a dropped SSH session)
tmux new -s basemap
curl -L -o go-pmtiles.tar.gz https://github.com/protomaps/go-pmtiles/releases/download/v1.31.2/go-pmtiles_1.31.2_Linux_x86_64.tar.gz
tar -xzf go-pmtiles.tar.gz
./pmtiles extract https://build.protomaps.com/<YYYYMMDD>.pmtiles basemap.pmtiles --bbox=-12,22,48,60
rclone copyto basemap.pmtiles bunny:<images-storage-zone>/basemap.pmtiles --progress
rm basemap.pmtiles   # ~40GB extract, free the disk
```

Set `PMTILES_URL=https://<maps-zone>.b-cdn.net/basemap.pmtiles` in Dokploy,
Deploy. **Env var changes need a redeploy** — Dokploy writes to `.env`, the
running container's environment is fixed at creation.

## 15a. Hillshade — the Mapterhorn mirror

**What this is.** The Barrington antiquity view (and only that view) draws a
hillshade from elevation tiles. Until now it fetched them from
`tiles.mapterhorn.com`, which is **Cloudflare** (checked 2026-10-02: `server:
cloudflare`, a `cf-ray` header), so every visitor on that view sent their
address to a US provider — and Mapterhorn's own privacy policy says it stores
IP, user agent and more for 30 days. A production build therefore now draws **no
relief** unless `TERRAIN_URL` points at a mirror on our own CDN, and the
production CSP does not allow `tiles.mapterhorn.com` at all. This section makes
the mirror and turns the relief back on. Until it is done the antiquity view is
simply flat; nothing else is affected.

**What gets mirrored.** One PMTiles archive cut from Mapterhorn's
`planet.pmtiles` (Terrarium-encoded WebP, 512 px, zoom 0–12 upstream): the
Europe + Mediterranean bounding box this project already uses, `-12,30,45,62`,
up to a chosen maximum zoom. MapLibre overzooms beyond the archive's own maximum,
which costs sharpness in a hillshade and nothing else. Measured with
`pmtiles extract --dry-run` on 2026-10-02:

| Max zoom | Archive size | Notes                                                  |
| -------- | ------------ | ------------------------------------------------------ |
| 9        | 634 MB       |                                                        |
| **10**   | **1.9 GB**   | **default** — plenty for a scenery layer under a sheet |
| 11       | 5.5 GB       |                                                        |
| 12       | 22 GB        | everything upstream has                                |

**Licence.** Mapterhorn's code is BSD-3-Clause; the elevation data is a mix of
open sources listed in `https://download.mapterhorn.com/attribution.json` (151
sources on 2026-10-02: CC BY 4.0, US-government public domain, Licence Ouverte
2.0, Datenlizenz Deutschland, Copernicus, CC0 and similar — no non-commercial
terms found). All of them require attribution. The map's credit now reads
"Elevation: Mapterhorn and the open elevation sources it lists" and links to
`https://mapterhorn.com/attribution`; the script stores `attribution.json` next
to the archive as `terrain-attribution.json` as the record of what is inside it.

**Steps.**

1. **Have the prerequisites on the VPS.** `curl`, `tar`, `sha256sum` (all in the
   base image) and `rclone` with the `bunny` remote from §10 step 6. Check:

   ```bash
   rclone listremotes          # must list: bunny:
   rclone lsd bunny:           # must list the storage zone
   df -h .                     # needs ~1.3× the archive size free (≈2.5 GB for the default)
   ```

2. **Get the script onto the VPS.** It is self-contained and downloads the pinned
   `pmtiles` CLI itself (SHA-256 checked):

   ```bash
   scp scripts/ops/mirror-terrain.sh <user>@<vps-ip>:~/
   ssh <user>@<vps-ip>
   chmod +x ~/mirror-terrain.sh
   ```

3. **Dry run — sizes only, nothing downloaded.** Use the same storage zone as the
   basemap (§15, `<images-storage-zone>`):

   ```bash
   tmux new -s terrain
   BUNNY_ZONE=<images-storage-zone> ./mirror-terrain.sh --dry-run
   # expect: "... for an archive size of 1.9 GB"
   ```

4. **The real run** (still in tmux; it survives a dropped SSH session). It
   extracts, runs `pmtiles verify`, checks the archive is WebP with the right
   maximum zoom, uploads `terrain.pmtiles` and `terrain-attribution.json`,
   compares byte counts on both sides, and deletes the local copy:

   ```bash
   BUNNY_ZONE=<images-storage-zone> ./mirror-terrain.sh
   # other sizes:  MAXZOOM=11 BUNNY_ZONE=<images-storage-zone> ./mirror-terrain.sh
   # other area:   BBOX=<min_lon,min_lat,max_lon,max_lat> ...
   ```

   It stops with a message at the first thing that is wrong. Do not use
   `terrain.pmtiles` if it reports a size mismatch.

5. **Check the CDN serves it correctly** — ranges and CORS, the same two things
   the basemap needs (§15). From any machine. Request a **deep** range, not just
   the start: the start of an object can come from an old cache entry while the
   origin is broken (see §15's note on the `<maps-zone>` pull zone):

   ```bash
   SIZE=$(rclone size --json bunny:<images-storage-zone>/terrain.pmtiles | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p')
   curl -sI -H "Origin: https://<domain>" -H "Range: bytes=$((SIZE / 2))-$((SIZE / 2 + 16383))" \
     https://<maps-zone>.b-cdn.net/terrain.pmtiles | grep -i -E "^HTTP|content-range|access-control|accept-ranges"
   # expect: HTTP/2 206, a content-range, and an access-control-allow-origin that allows <domain>
   ```

   A 404 here means the URL's pull zone is not the one whose origin is the
   storage zone (e.g. `<images-zone>`, whose origin is imgproxy). If the pull
   zone strips CORS or ranges, the basemap would already be broken; fix it
   there (§15) rather than here.

6. **Turn it on.** Dokploy → this project → Environment:

   ```
   TERRAIN_URL=https://<maps-zone>.b-cdn.net/terrain.pmtiles
   ```

   `docker/compose.prod.yml` passes it on as `NUXT_PUBLIC_BASEMAP_TERRAIN_URL`.
   **Deploy** — an environment change needs a redeploy (§15). No rebuild is
   involved: the value is read at container start.

7. **Verify in a browser.** Open the site → Maps → Antiquity (Barrington). The
   sheet shows shaded relief. In DevTools → Network, filter `terrain`: you must
   see only `*.b-cdn.net/terrain.pmtiles` range requests (status 206) and **no
   request to `mapterhorn.com` or `cloudflare`**. The attribution (ⓘ) must read
   "Elevation: Mapterhorn and the open elevation sources it lists".

**Updating.** Mapterhorn republishes now and then. Re-run step 4 with a new
dated object name (`OBJECT=terrain-YYYYMMDD.pmtiles`), repeat step 5 against it,
point `TERRAIN_URL` at it and redeploy, then delete the old object. Don't
overwrite `terrain.pmtiles` in place: the pull zone ignores query strings, so a
`?v=…` cannot bust the cache, and browsers hold byte ranges of the old layout.
A URL-level purge (Pull Zone → Purge Cache → URL) is the fallback.

**Rolling back.** Unset `TERRAIN_URL` and redeploy: the antiquity view goes back
to flat. Do **not** point it at `https://tiles.mapterhorn.com/...` — production's
CSP refuses that host on purpose.

## 15b. Reference datasets — Itiner-e, Nomisma, Wikidata monuments, I.Sicily, Cliopatria, Atlas of Hillforts

**What this is.** Six datasets drawn as map layers or pages, each mirrored into our
own Postgres so a visitor's browser asks nobody else for anything (no new CSP origin,
no new third-party request). Sources, licences and the facts behind each are in
`.claude/rules/reference-overlays.md`; the credits are on `/licence`.

| Table                   | Rows (dev, 4 Oct 2026) | Layer / page                                                     |
| ----------------------- | ---------------------- | ---------------------------------------------------------------- |
| `antiquity_roman_roads` | 14,769                 | Overlays → Roman roads                                           |
| `antiquity_mints`       | 2,194                  | Overlays → Mints                                                 |
| `antiquity_monuments`   | 3,437                  | Overlays → Roman monuments                                       |
| `antiquity_polities`    | 655 (87 realms)        | Ancient empires → Neighbouring realms (under the slider)         |
| `isicily_inscriptions`  | 5,136 (5,009 located)  | Overlays → Sicilian inscriptions, and `/inscriptions/sicily/:id` |
| `antiquity_hillforts`   | 4,147                  | Overlays → Hillforts                                             |

**Release order — everything in the reference-layers release, in sequence.** The order
matters: restoring before the deploy finds no tables, and skipping step 5 can serve
empty tiles cached before the data arrived.

1. **Dokploy → Environment:** make sure `TABULA_PEUTINGERIANA_ENABLED` is either absent
   (the compose default is now `true`) or `true`. An explicit `false` left over from
   before keeps the overlay off. Nothing else is new: no secret, no pull zone, no CSP origin.
2. **Deploy the new build** (Dokploy → Deploy). Its `migrate` service creates the tables
   (§14a: `0030` five tables, `0031` hillforts) before the app starts; the `migrate`
   container's log ends in `Migrations applied.`. If you already deployed an older image
   that lacks the service and applied the SQL by hand with the tracking rows (§14a fallback),
   the service finds nothing to do.
3. **Confirm the tables exist and are empty:**
   `docker exec <postgres-container> psql -U vestigian -d vestigian -c "SELECT count(*) FROM antiquity_hillforts"`
   → `0`.
4. **Load the data** — "Load the data" below, steps 1–3 (local imports, data-only dump,
   restore, count check).
5. **Bump the tile generation** — step 4 below (`INCRBY 2`, not `INCR`). Always,
   also on a first release: the Cliopatria tile SQL was changed after its first dev
   tiles were cached, and one bump costs nothing.
6. **Verify from outside** — the curls below, then switch each of the six overlays on
   once and the scrubber on, and check the credit shows in the attribution line.
7. **Check `/licence`** in the browser (new credits, and the query-parameter hints under
   the two feeds), and `/api/data/sites.geojson?limit=2&offset=2` answers.
8. **Pull-zone cache:** nothing to purge for new paths. Purge only `/licence` and `/` if a
   stale HTML copy is served after the deploy (Pull Zone → Purge Cache → URL).

**Nothing new to configure.** No environment variable, no secret, no pull zone, no
CSP change. The tables are created by migrations `0030` and `0031`, which the `migrate` service
(§14a) applies on the deploy. Until the data below is loaded the six overlays draw nothing
and the detail pages answer 404, and nothing else is affected.

**Load the data** (once per dataset refresh). It is a data-only dump of just these
six tables from the machine that ran the imports, restored into the running
Postgres. Do **not** run the import scripts on the VPS: they need the repository,
Node and the `.import/` caches, and the dump is the route §14 already established.

```bash
# 1. Local — the dev database already holds the data (counts in the table above); re-run
#    the six `pnpm import:*` scripts first only when refreshing. There is no local
#    pg_dump, so dump through the dev container (PostgreSQL 17, same as production).
docker exec vestigian-dev-postgres-1 pg_dump -U vestigian -d vestigian \
  -Fc --no-owner --no-acl --data-only \
  -t antiquity_roman_roads -t antiquity_mints -t antiquity_monuments \
  -t antiquity_polities -t isicily_inscriptions -t antiquity_hillforts \
  > reference-layers.dump
ls -lh reference-layers.dump                                   # ~17 MB
docker exec -i vestigian-dev-postgres-1 pg_restore --list < reference-layers.dump \
  | grep -c "TABLE DATA"                                       # expect 6
rsync -avP reference-layers.dump deploy@<vps-ip>:/tmp/

# 2. VPS — the deploy must be done (migrations applied, §14a), so the tables exist and are empty.
docker exec <postgres-container> psql -U vestigian -d vestigian -c \
  "TRUNCATE antiquity_roman_roads, antiquity_mints, antiquity_monuments,
            antiquity_polities, isicily_inscriptions, antiquity_hillforts RESTART IDENTITY"
docker exec -i <postgres-container> pg_restore \
  --no-owner --no-acl --data-only -U vestigian -d vestigian < /tmp/reference-layers.dump

# 3. VPS — check the counts against the table above.
docker exec <postgres-container> psql -U vestigian -d vestigian -c "
  SELECT 'roads' AS t, count(*) FROM antiquity_roman_roads UNION ALL
  SELECT 'mints', count(*) FROM antiquity_mints UNION ALL
  SELECT 'monuments', count(*) FROM antiquity_monuments UNION ALL
  SELECT 'polities', count(*) FROM antiquity_polities UNION ALL
  SELECT 'isicily', count(*) FROM isicily_inscriptions UNION ALL
  SELECT 'hillforts', count(*) FROM antiquity_hillforts"

# 4. VPS — tell the app the atlas changed. Tiles are cached in Valkey under a generation
#    counter that a restore does not touch; without this the first requests can be served
#    empty tiles cached before the data arrived.
#    INCRBY 2, never plain INCR: an unset counter already reads as 1, and INCR on a missing
#    key creates it at 1 — the generation would not move and every cached tile (including
#    the empty ones) would stay valid. INCRBY 2 lands on 2 when unset, N+2 otherwise.
docker exec <valkey-container> valkey-cli INCRBY vestigian:atlas-version 2
#    Check: any tile response must now carry x-atlas-version of 2 or more, never 1.
curl -sI https://<domain>/api/tiles/reference/hillforts/9/252/170.mvt | grep -i x-atlas-version
```

_Rehearsed 4 Oct 2026 against a scratch database in the dev Postgres container, with all six
tables: migrations `0030`/`0031` created them empty, the dump listed six `TABLE DATA` entries,
the restore gave exactly the counts above (text arrays and numerics included), and the next
insert into `antiquity_hillforts` took `id` 4148 (the sequences came across)._

**Verify from outside** (replace `<domain>`):

```bash
curl -s -o /dev/null -w '%{http_code} %{size_download}B\n' \
  https://<domain>/api/tiles/reference/roman-roads/6/33/22.mvt            # 200, a few KB
curl -s https://<domain>/api/isicily-inscriptions/ISic000001 | head -c 200  # JSON, "Funerary inscription of Zethus"
curl -s -o /dev/null -w '%{http_code}\n' \
  https://<domain>/api/tiles/antiquity-polities/-200/4/8/5.mvt              # 200 or 204, never 4xx/5xx
```

Then open the map, switch each overlay on once and confirm the credit appears in the
attribution line (it leaves with the layer). **No Bunny purge is needed** — these are
new paths. Only if one of them answers a cached `404` from before the deploy, purge that
URL in the pull zone.

**A layer is missing at some zooms only** (seen on the first release: hillforts present up to
zoom 6, gone from 7). The data and the endpoint are fine — an empty `204` tile, requested while
the table was still empty, is being served from one of two caches. Tile URLs carry no
generation, so neither cache knows the data arrived. Find which:

```bash
# a high-zoom tile over Britain; -D - prints the response headers
curl -s -D - -o /dev/null https://<domain>/api/tiles/reference/hillforts/8/126/85.mvt | \
  grep -iE '^(HTTP|x-tile-cache|x-atlas-version|cdn-cache|content-length)'
```

- `200` with a body → the server is right; clear the browser's cache (private window).
- `204` and `x-tile-cache: hit` → Valkey holds the empty tile: run the `INCRBY 2` above (step 4 of "Load the data") — and if `x-atlas-version` was `1`, that is the cause: the earlier bare `INCR` left the counter at 1.
- `204` and `cdn-cache: HIT` (no `x-tile-cache`) → Bunny holds it (`max-age=86400`, stale
  copies up to a week): on the pull zone whose **Hostnames** list the domain, press the
  plain **Purge Cache** button. A wildcard Purge URL (`…/reference/*`) did not clear these on
  the first release; the full purge did. Query strings and `no-cache` request headers do not
  get past the cache, so a curl cannot tell you the origin is fine — use a tile that was never
  requested (its `cdn-cache` says `MISS`) to read the generation the origin really serves.

Avoid it by not opening the overlays in a browser between the deploy and the bump — a
browser pans through high-zoom tiles and leaves the empty ones in the pull zone.

**Backups.** The five `antiquity_*` tables are excluded from the nightly dump by
design (`docker/backup.sh`) and are rebuilt from the dump above or the import scripts
after a restore; `isicily_inscriptions` is included in the nightly dump (it is small).
`docker/restore-drill.sh` therefore does not prove these five — re-run step 2 after
a disaster restore.

**Refreshing.** Re-run the matching import locally and repeat steps 1–4. Each import is
guarded (`import_runs`): it refuses an upstream that shrank by more than 10 % or grew
threefold, and prints `content-changed` when the bytes differ at the same row count.
I.Sicily's `master` branch moves continuously, so `content-changed` there is routine.

**Licence reminders that are operational, not legal fine print:** six I.Sicily records
are **CC BY-NC 4.0** (non-commercial use only) — the detail page says so per record;
if this deployment ever becomes commercial, filter `licence = 'CC-BY-NC-4.0'` out of
`reference-layers.ts`'s `isicilyTileSql` and `loadIsicilyInscriptionDetail`. I.Sicily's
**photographs are not mirrored** and must not be (see the rules file).

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

- **Hillshade mirror (§15a).** Not run yet. Until `TERRAIN_URL` is set the
  Barrington antiquity view draws no relief — by design, because the public
  host is Cloudflare. Script: `scripts/ops/mirror-terrain.sh`.
- **`RESTIC_*` off-box backups (§20).** Nightly dump still never leaves the box.
  The target is **netcup Storage Space** over NFS; nothing is booked or mounted
  yet. See `.claude/rules/deployment-and-releases.md`.
- **Bunny CrowdSec bouncer** (`docker/security/bunny-bouncer/`). The Edge Rule
  version failed on the real API: manual `edgerules/addOrUpdate` calls
  succeeded, the poller failed with a misleading `"Maximum 5 triggers are
allowed per condition"`, root cause never found. **Rewritten 2026-10-03** to
  use the pull zone's blocked-IP list (`addBlockedIp` / `removeBlockedIp`,
  confirmed in Bunny's API reference) with paced per-IP calls and 429 handling.
  Exercised only against a mock so far. Still **stopped** until this passes:
  1. `docker compose up -d --build bunny-bouncer`, watch its log for
     `LAPI and Bunny both reachable`.
  2. `docker exec <crowdsec> cscli decisions add --ip <your-test-ip> --duration 10m`
     and confirm the log shows `synchronised with Bunny`.
  3. From that IP, `curl -sI https://<domain>/` must be refused by Bunny (not a
     404 from Traefik); then `cscli decisions delete --ip <your-test-ip>` and
     confirm it works again within a poll interval.
  4. Burst test: add ~50 test decisions, watch for 429s in the log.
     Origin is protected by §9's secret header regardless — this only adds
     automatic banning at Bunny's edge. If step 3 or 4 fails, fall back to the
     CrowdSec Traefik plugin bouncer (`docker/security/README.md`, option 2).
- **CrowdSec community sharing — decide later; left unchanged.**
  `docker/compose.prod.yml` sets `DISABLE_ONLINE_API: 'false'`, so IP addresses
  the local engine flags as abusive are sent to CrowdSec's central API. Checked
  2026-10-02 with a real lookup: `api.crowdsec.net` resolves to AWS address space
  (AS16509) geolocated in Ireland — an EU region, but run by a French company on
  a US-parent cloud, which sits awkwardly beside "EU-based providers". It is
  already disclosed (`privacy.recipientSecurity`, and `about.euException` in all
  six locales). Options: **keep** (community blocklist, as disclosed) or set
  `DISABLE_ONLINE_API: 'true'` (nothing visitor-derived leaves the box; local
  detection still works, the community blocklist is lost). If it changes, update
  the compose file, both i18n keys in every locale, and the table in
  `.claude/rules/gdpr-legal.md`.
- ~~CORS wildcard~~ — fixed 2026-09-30, see §12's `NUXT_SECURITY_CORS_HANDLER_ORIGIN` note.
- **Oxford Roman Economy Project databases — ask for terms, then decide.** Shipwrecks,
  mines, quarries, olive-oil and wine presses, water technology and cities
  (`oxrep.classics.ox.ac.uk/databases`). The pages state **no licence** ("Content: OXREP,
  2005–2026"), the site-wide terms page returned 403 behind an Oxford SSO login when
  checked, and quarries' coordinates are only "accurate to within several kilometres".
  Not mirrorable until someone with an Oxford contact has an explicit yes. The
  _Cities_ database carries a Bodleian DOI, which may carry its own licence — check
  that first. Detail: `.claude/rules/antiquity-basemaps.md`, "Researched and rejected".
- **EDH photographs — ask Heidelberg for permission, or leave out.** The EDH
  inscription _texts_ are CC BY-SA 4.0 and mirrored; the **43,199 photograph records
  are all Europeana `rr-f` ("Rights Reserved – Free Access")**, re-checked 3 Oct 2026
  against 2,000 local metadata files. We store metadata and a link-out only
  (`scripts/import/13-edh-inscription-images.ts`), no bytes. To show or mirror them
  EDH has to grant it in writing; the import already re-checks every record's rights
  text (`isOpenRightsStatement`), so a genuinely open licence upstream would be picked
  up without a code change.
- **Further sources investigated 3–4 Oct 2026, not built** — Portable Antiquities Scheme (terms say CC BY 3.0 but the site
  blocks us and find-spot rules are unread — ask), Trismegistos (licence unverified),
  OSM `historic=archaeological_site` (ODbL, mixed value). Table and reasoning:
  `.claude/rules/reference-overlays.md`, "Candidates investigated and not built".
- **Ask AFE (afe@dainst.de) and PAS for an explicit licence to mirror their
  single coin-find data.** AFE states none. PAS's website terms (read from a Wayback
  copy of 3 Dec 2025, because the site answers 403 to us) say "We licence all our work
  under a Creative Commons Share-Alike agreement (CC BY 3.0)", which is self-contradictory
  and says nothing about the records' find-spot precision — so ask rather than assume. See
  `.claude/rules/antiquity-basemaps.md`'s coin-finds section for the full
  per-source research (2026-09-14). The site panel that used to link out to
  these databases was removed 2026-09-30 for adding no reader benefit, but
  the underlying question — whether this data could ever be imported outright,
  on the CHRR model — is independent of that panel and still open.

## 20. Off-site backups — netcup Storage Space

The nightly dump is pushed by restic to a directory on **netcup Storage Space**:
an external storage cluster that netcup attaches to a VPS over **NFS** and
authorises by **registered IP address** (product page,
`https://www.netcup.com/en/server/storage-space`: "The storage space is addressed
using NFS", "Customers are registered to use the storage space via their IP
address"; tariffs A 250 GB / B 500 GB / C 1 TB). restic encrypts client-side, so
netcup never holds a readable copy. The repository is a plain directory, so the
backup container needs no ssh client, key or known_hosts.

1. **Book it.** netcup Customer Control Panel (CCP) → book Storage Space for this
   VPS (tariff A is far more than a 58 MB dump needs). The CCP then shows the NFS
   server and export path, and registers `<vps-ip>` as allowed.
2. **Mount it on the VPS.** Use the server and path the CCP shows:

   ```bash
   apt-get install -y nfs-common
   mkdir -p /mnt/netcup-backup
   echo '<nfs-server>:<export-path> /mnt/netcup-backup nfs defaults,_netdev 0 0' >> /etc/fstab
   mount -a
   df -h /mnt/netcup-backup        # must show the Storage Space, not the root disk
   ```

   If `mount` fails, add the options the CCP documents (the NFS version in
   particular — **not verified here**, netcup's page does not state it).

3. **Create the repository directory and the marker** — once, on the mounted
   storage. The `backup` container runs as uid 70 (`postgres`), so it must be able
   to write there:

   ```bash
   mkdir -p /mnt/netcup-backup/restic
   touch /mnt/netcup-backup/.vestigian-offsite
   chown -R 70:70 /mnt/netcup-backup/restic
   ```

   The marker is what stops a missing mount from passing as a backup: without it
   `backup.sh` reports `reason=offsite-not-mounted` and writes nothing.

4. **Set the variables in Dokploy:**

   ```
   RESTIC_REPOSITORY=/offsite/restic
   RESTIC_OFFSITE_DIR=/mnt/netcup-backup
   RESTIC_PASSWORD=<openssl rand -base64 32>   # store a copy OUTSIDE this VPS and this repo
   ```

   `RESTIC_PASSWORD` **is** the backup: lose it and every snapshot is unreadable.

5. **Redeploy** (the `backup` image changed: it no longer carries ssh), then watch
   the first run:

   ```bash
   docker compose logs -f backup | grep backup.outcome
   # expect: stage=dump ok, stage=offsite ok
   ```

6. **Prove it restores** — a backup nobody has restored is not one. On the VPS
   (the drill reads the repository by its **host** path, not the container's):

   ```bash
   RESTIC_REPOSITORY=/mnt/netcup-backup/restic RESTIC_PASSWORD=... docker/restore-drill.sh --offsite
   ```

**Known weakening.** A previous SFTP design could restrict the key to one path;
an NFS mount is writable by anything on the VPS that can reach it, so a
compromised host can delete the repository as well as write it. Treat the Storage
Space as a second copy, keep the local 14-day dumps, and consider a periodic copy
to a second, unrelated target.
