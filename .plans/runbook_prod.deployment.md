# Erstdeployment-Runbook (korrigiert: es gibt keine Cloud-Migration)

## Kontext — was ich falsch angenommen hatte

Das vorherige Runbook beschrieb eine Migration R2 → Bunny. **Die ist hinfällig:
es liegt nichts in der Cloud.** Alles ist lokal. Es gibt kein R2-Bucket, keinen
Server, keine Produktion.

Was stattdessen vorliegt, geprüft:

| | |
| --- | --- |
| Objekte in lokalem MinIO | **28.630, 15 GiB** |
| `storage_key` in der DB | 36.216 distinct |
| davon `approved` (= gespiegelt) | 28.629 |
| davon `pending` (= noch nicht geladen) | **7.527** |
| PMTiles-Basemap | **existiert nicht**, `BASEMAP_PROVIDER=openfreemap` |

Daraus folgen zwei Befunde, die beide gewichtiger sind als die gestrichene
Migration.

**Der Bildspiegel ist zu ~79 % fertig.** 7.527 Bilder fehlen noch.
`import:images` ist resumierbar; bei 1,2 s Abstand sind das ~2,5 Stunden.

**Die 15 GiB liegen auf genau einer Maschine, ohne Backup.** CLAUDE.md sagt
selbst, dass die Fotos nicht reproduzierbar sind — ein erneuter Spiegel kostet
René Voorburgs Bandbreite ein zweites Mal. Ein Plattenschaden auf diesem Laptop
kostet heute 36.000 fremde Requests. Das ist das dringendste offene Risiko im
ganzen Projekt und war in keinem bisherigen Plan enthalten.

Aus „Migration" wird also **Erstbefüllung**, und sie bekommt einen Schritt davor.

---

## 0. Spiegel fertigstellen (lokal, vor allem anderen)

Solange nur lokal gearbeitet wird, ist das billig und ohne Risiko.

```bash
pnpm import:images          # nimmt die 7.527 pending auf, resumierbar
pnpm images:reconcile       # muss danach missing: 0 melden
```

`reconcile` wird ein **orphan** melden — ein Objekt aus meinem Upload-Test,
dessen DB-Zeile ich gelöscht habe. Unkritisch, nichts löscht Bytes.

**Erst wenn `import:images` durch ist, lohnt der Upload nach Bunny** — sonst
überträgt man zweimal.

---

## 1. Bilder lokal → Bunny (Erstbefüllung, keine Migration)

Bunnys S3-API ist seit Juli 2026 **Public Preview**, nicht stabil. Deshalb:

| Komponente | Weg |
| --- | --- |
| Upload aus der App (`images.post.ts`) | S3-Preview über den vorhandenen `@aws-sdk/client-s3` — schreibt selten, Fehler sind sichtbar und wiederholbar |
| **imgproxy** | **nicht** S3, sondern die Pull-Zone per HTTPS. `IMGPROXY_USE_S3` aus. Umgeht die Preview-API im Lesepfad — und das ist der Hot Path |
| `reconcile-images.ts` | S3-Preview, liest nur Objektlisten |

```bash
# Storage Zone in Bunny anlegen (Falkenstein), Pull Zone davor.
# rclone-Remotes: minio (lokal) und bunny (S3-Preview-Endpoint)

rclone sync minio:vestigia bunny:vestigia --progress --transfers 16 --checksum
rclone size minio:vestigia && rclone size bunny:vestigia   # müssen übereinstimmen
```

Freigabekriterium, gegen das neue Ziel, ohne Produktionsconfig anzufassen:

```bash
NUXT_STORAGE_ENDPOINT=<bunny-s3-endpoint> \
NUXT_STORAGE_BUCKET=vestigia \
NUXT_STORAGE_ACCESS_KEY_ID=<key> \
NUXT_STORAGE_SECRET_ACCESS_KEY=<secret> \
pnpm images:reconcile          # missing muss 0 sein
```

**Das lokale MinIO bleibt danach stehen.** Es ist die einzige zweite Kopie, bis
es eine echte Backup-Strategie gibt.

---

## 2. Basemap beschaffen

Existiert noch gar nicht. Produktion setzt `BASEMAP_PROVIDER=pmtiles` voraus.

```bash
# Europa+Mittelmeer-Extrakt von maps.protomaps.com holen (~15–25 GB),
# nach Bunny hochladen, dann:
#   NUXT_PUBLIC_BASEMAP_PROVIDER=pmtiles
#   NUXT_PUBLIC_BASEMAP_PMTILES_URL=https://<pull-zone>.b-cdn.net/basemap.pmtiles
```

Reproduzierbar, also risikolos — jederzeit neu beziehbar.

---

## 3. Erstes Deployment

```bash
# Dokploy-Env
BUNNY_S3_ENDPOINT / BUNNY_BUCKET / BUNNY_ACCESS_KEY_ID / BUNNY_SECRET_ACCESS_KEY
IMAGE_BASE_URL=https://<pull-zone>.b-cdn.net
PMTILES_URL=https://<pull-zone>.b-cdn.net/basemap.pmtiles
NUXT_BEHIND_TRUSTED_PROXY=false        # bis Schritt 4 steht!
```

Redeploy ist zwingend, nicht nur ein Env-Wechsel: `mapAssetOrigins` und
`imageOrigin` in `nuxt.config.ts` werden **zur Buildzeit** aufgelöst, die CSP
nennt sonst den alten Host.

Prüfen: Karte laden, Konsole auf CSP-Verstöße ansehen, ein Site-Panel mit Foto
öffnen, `curl -I https://<image-host>/r/card/<key>` → 200, `image/webp`.

---

## 4. Origin-Firewall — erst danach `BEHIND_TRUSTED_PROXY=true`

`true` ohne diese Regel ist **schlechter als `false`**: die App glaubt dann einen
Header, den jeder setzen kann, der die Hetzner-IP findet — und bekommt pro
Request einen frischen Rate-Limit-Bucket.

Hetzner Cloud Console → Firewall, eingehend: 80/443 nur aus Bunnys Edge-Ranges
(`https://api.bunny.net/system/edgeserverlist/plain`), 22 nur von der eigenen
Adresse, sonst nichts. Liste ändert sich gelegentlich → monatlich nachziehen.

```bash
curl -m 5 https://<origin-ip>/api/health    # muss timeouten
curl -m 5 https://<site-host>/api/health    # muss 200 liefern
```

Beides muss stimmen, dann `NUXT_BEHIND_TRUSTED_PROXY=true`.

---

## 5. CrowdSec-Bouncer

CrowdSec ist zweigeteilt: die Engine *erkennt* und schreibt eine Entscheidung,
ein *Bouncer* liest sie und blockiert. Aktuell läuft nur die erste Hälfte —
`cscli decisions list` zeigt Bans, der Client wird weiter bedient. Bewusst: erst
beobachten, welche Szenarien real feuern, dann scharfschalten.

```bash
docker exec vestigia-crowdsec-1 cscli bouncers add traefik-bouncer
```

Dokploy UI → Traefik → **statische** Config: Plugin `crowdsec-bouncer-traefik-plugin`
registrieren. Dann dynamische Config: Middleware mit `crowdsecLapiHost: crowdsec:8080`
und dem Key. Zuletzt am App-Router anhängen:
`app-rate-limit@file,crowdsec@file`.

```bash
docker exec vestigia-crowdsec-1 cscli decisions add --ip <test-ip> -d 2m
curl -I https://<site-host>/                     # 403
docker exec vestigia-crowdsec-1 cscli decisions delete --all
```

**Vorher klären:** `docker/traefik/` ist an keinen Container gemountet. Dokploy
hält die echte Config in `/etc/dokploy/traefik/`. Die drei bestehenden
`@file`-Middlewares haben womöglich nie aufgelöst:

```bash
ls /etc/dokploy/traefik/dynamic/
docker logs <traefik-container> 2>&1 | grep -i "middleware.*not found"
```

Entweder die Repo-Dateien dorthin kopieren und das Repo als Quelle behandeln,
oder `docker/traefik/` löschen. Keine vierte Middleware auf einen ungeprüften
Mechanismus setzen.

---

## Reihenfolge und Rollback

0 → 1 → 2 → 3 → 4 → 5, einzeln deployen.

| Schritt | Rollback |
| --- | --- |
| 1 Upload | nichts zu tun, MinIO bleibt unangetastet |
| 3 Deployment | Env zurück, redeploy |
| 4 Firewall | Regel löschen, `BEHIND_TRUSTED_PROXY=false` |
| 5 Bouncer | Middleware vom Router nehmen, Erkennung läuft weiter |

## Offen

- **Off-box-Backup der 15 GiB.** Bis Schritt 1 läuft, existieren sie einmal.
  Danach zweimal (lokal + Bunny), aber Bunny ist kein Backup, sondern
  Auslieferung. Das dringendste ungelöste Risiko.
- Edge-Bouncer statt Traefik-Bouncer (Traefik blockt erst nach dem
  TLS-Handshake; gegen L7-Floods hilft nur die Edge).
- Bunny Shield im Dashboard aktivieren (Free-Tier: WAF + L7-DDoS).
