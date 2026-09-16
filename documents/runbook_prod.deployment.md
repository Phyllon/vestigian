# Erstdeployment-Runbook (korrigiert: es gibt keine Cloud-Migration)

**Status (2026-09-07): noch nicht ausgeführt.** Dies ist ein Plan, kein
Protokoll — keiner der Schritte 0–6 ist bisher gelaufen, es existiert weder
ein Bunny-Storage-Objekt noch ein deployter Server. Die Zahlen unter
„Kontext" (28.630 Objekte, 7.527 pending etc.) sind der zuletzt geprüfte
lokale Stand, nicht das Ergebnis eines Laufs dieses Runbooks — vor der
tatsächlichen Ausführung mit `pnpm images:reconcile` erneut prüfen, falls
seither Zeit vergangen ist.

## Kontext — was ich falsch angenommen hatte

Das vorherige Runbook beschrieb eine Migration R2 → Bunny. **Die ist hinfällig:
es liegt nichts in der Cloud.** Alles ist lokal. Es gibt kein R2-Bucket, keinen
Server, keine Produktion.

Was stattdessen vorliegt, geprüft:

|                                        |                                                     |
| -------------------------------------- | --------------------------------------------------- |
| Objekte in lokalem MinIO               | **28.630, 15 GiB**                                  |
| `storage_key` in der DB                | 36.216 distinct                                     |
| davon `approved` (= gespiegelt)        | 28.629                                              |
| davon `pending` (= noch nicht geladen) | **7.527**                                           |
| PMTiles-Basemap                        | **existiert nicht**, `BASEMAP_PROVIDER=openfreemap` |

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

| Komponente                            | Weg                                                                                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Upload aus der App (`images.post.ts`) | S3-Preview über den vorhandenen `@aws-sdk/client-s3` — schreibt selten, Fehler sind sichtbar und wiederholbar                       |
| **imgproxy**                          | **nicht** S3, sondern die Pull-Zone per HTTPS. `IMGPROXY_USE_S3` aus. Umgeht die Preview-API im Lesepfad — und das ist der Hot Path |
| `reconcile-images.ts`                 | S3-Preview, liest nur Objektlisten                                                                                                  |

```bash
# Storage Zone in Bunny anlegen (Falkenstein), Pull Zone davor.
# rclone-Remotes: minio (lokal) und bunny (S3-Preview-Endpoint)

rclone sync minio:vestigian bunny:vestigian --progress --transfers 16 --checksum
rclone size minio:vestigian && rclone size bunny:vestigian   # müssen übereinstimmen
```

Freigabekriterium, gegen das neue Ziel, ohne Produktionsconfig anzufassen:

```bash
NUXT_STORAGE_ENDPOINT=<bunny-s3-endpoint> \
NUXT_STORAGE_BUCKET=vestigian \
NUXT_STORAGE_ACCESS_KEY_ID=<key> \
NUXT_STORAGE_SECRET_ACCESS_KEY=<secret> \
pnpm images:reconcile          # missing muss 0 sein
```

**Das lokale MinIO bleibt danach stehen.** Es ist die einzige zweite Kopie, bis
es eine echte Backup-Strategie gibt.

---

## 2. Datenbank: lokal → Produktion

**Die konkrete Frage war: Zip-Datei bauen, auf den VPS schieben, dort ein
Skript entpacken und in die Produktions-DB laden lassen?** Antwort: nein,
und zwar aus einem einfachen Grund — `pg_dump` im Custom-Format (`-Fc`)
komprimiert bereits selbst (zlib, vergleichbar mit gzip). Eine zweite
Kompressionsstufe (Zip) auf eine bereits komprimierte Datei bringt kaum
etwas, dafür aber zwei zusätzliche, fehleranfällige Schritte (packen,
entpacken) und ein selbstgeschriebenes Lade-Skript, wo Postgres bereits ein
fertiges, genau dafür gebautes Werkzeugpaar mitbringt: `pg_dump` /
`pg_restore`. Kein Skript nötig, das jemand pflegen müsste.

**Größenordnung, gemessen statt geschätzt:** die lokale DB liegt laut
`documents/summary.md` bei ~190 MB gesamt, davon ~75 MB allein
`antiquity_*` (siehe unten). Für eine Datenmenge dieser Größe ist der
einfachste Weg auch der richtige — es gibt hier kein Performance-Problem zu
lösen, nur ein Korrektheits- und Sequenzproblem.

**Eine echte Entscheidung, nicht nur Mechanik: `pnpm db:snapshot`
NICHT verwenden.** Dieses Skript existiert für die _nächtlichen_ Backups
und schließt `antiquity_*`-Zeilen absichtlich aus (Schema bleibt, Tabellen
kommen leer wieder hoch) — richtig für ein Backup, das jede Nacht läuft und
notfalls durch `pnpm import:atlas` & Co. wieder gefüllt wird, aber falsch
für eine **einmalige** Erstbefüllung: das hieße, nach dem Restore auf dem
VPS ein gutes Dutzend Import-Skripte nachzuziehen
(`import:atlas`, `import:limes`, `import:tabula-peutingeriana`,
`import:battles`, `import:ports`, `import:orbis-routes`,
`import:awmc-features`, `import:awmc-lines`, `import:chrr-coin-hoards`,
`import:ohm-empire-extents`, `import:column-reliefs`, `import:cities`,
`import:edh-findspots`, `import:country-boundaries`), von denen jedes noch
einmal eine andere dritte Quelle anfragt — bei 75 MB Ersparnis, gemessen an
den ~190 MB Gesamtgröße, ist das ein schlechter Tausch für ein
Ereignis, das genau einmal passiert. Stattdessen ein vollständiger Dump,
ohne Ausschluss:

```bash
# Lokal: vollständiger Dump, nichts ausgeschlossen — anders als db:snapshot
pg_dump "$NUXT_DATABASE_URL" -Fc --no-owner --no-acl -f vestigian-full.dump

# Vor dem Versand: die Dump-Datei selbst prüfen, nicht erst nach dem Restore
pg_restore --list vestigian-full.dump | wc -l   # grobe Plausibilität: Tabellenzahl

# Übertragung — rsync statt scp, wegen --partial (fortsetzbar, falls die
# Verbindung während der Übertragung abbricht; bei ~190 MB unwahrscheinlich,
# aber ohne Zusatzkosten)
rsync -avP vestigian-full.dump <vps>:/tmp/

# Auf dem VPS: Postgres-Container muss stehen und initdb bereits gelaufen
# sein (postgis/pg_trgm/unaccent-Extensions kommen aus
# docker/initdb/01-extensions.sql beim allerersten Start des leeren Volumes),
# aber NICHT `pnpm db:migrate` — der Dump bringt das komplette Schema schon
# mit, ein vorheriges migrate würde auf bereits existierende Relationen
# treffen.
docker compose -f docker/compose.prod.yml up -d postgres
docker exec -i vestigian-postgres-1 pg_restore \
  --no-owner --no-acl --clean --if-exists \
  -U vestigian -d vestigian < /tmp/vestigian-full.dump
```

`--clean --if-exists` macht den Restore wiederholbar, falls beim ersten
Versuch etwas schiefgeht — ohne diese beiden Flags bricht ein zweiter
Versuch an "relation already exists" ab. `--no-owner --no-acl`, weil der
Dump-Rollenname (`vestigian`, lokal) und der Ziel-Rollenname zwar hier
übereinstimmen, aber nichts garantiert, dass das immer so bleibt — billige
Absicherung gegen einen Owner-Mismatch-Fehler, der den ganzen Restore
abbrechen würde.

**Bilder-Metadaten und Bild-Bytes laufen getrennt, müssen aber beide vor
dem Go-Live fertig sein.** `site_images.storage_key` kommt mit diesem Dump
mit; die eigentlichen Objekte wandern über den `rclone sync` aus Schritt 1.
Storage-Keys leiten sich aus Datenbank-IDs ab, nie aus Dateinamen (siehe
CLAUDE.md, "Security invariants") — solange beide Schritte irgendwann vor
dem ersten echten Seitenaufruf abgeschlossen sind, spielt die Reihenfolge
zwischen ihnen keine Rolle. Die Cichorius-Platten der Trajanssäule
(`column_relief_plates`) hängen genauso von beidem ab und laufen über
denselben `rclone sync`, nicht separat.

**Kein Zwischenschritt für Valkey nötig.** Sitzungen, Rate-Limits und der
Tile-Cache sind laut Design regenerierbar (siehe CLAUDE.md, "Valkey") — ein
leerer Valkey auf dem VPS ist der korrekte Startzustand, kein
Migrationsschritt.

---

## 3. Basemap beschaffen

Existiert noch gar nicht. Produktion setzt `BASEMAP_PROVIDER=pmtiles` voraus.

```bash
# Europa+Mittelmeer-Extrakt von maps.protomaps.com holen (~15–25 GB),
# nach Bunny hochladen, dann:
#   NUXT_PUBLIC_BASEMAP_PROVIDER=pmtiles
#   NUXT_PUBLIC_BASEMAP_PMTILES_URL=https://<pull-zone>.b-cdn.net/basemap.pmtiles
```

Reproduzierbar, also risikolos — jederzeit neu beziehbar.

---

## 4. Erstes Deployment

### 4.0. Wie die Werte sicher auf den Server kommen

**Geprüft, nicht angenommen** (`docs.dokploy.com/docs/core/variables` und
`.../docker-compose`, live abgerufen): Variablen, die man in Dokploys eigener
UI unter "Environment" einträgt, landen laut Dokploys eigener Dokumentation
selbst **in einer `.env`-Datei im Deployment-Verzeichnis** — sie werden
"nicht automatisch in Container injiziert", sondern müssen im Compose-File
über `env_file` oder `${VAR}` referenziert werden, genau wie eine von Hand
angelegte `.env` neben dem Compose-File auch. Ob diese Datei serverseitig
zusätzlich verschlüsselt abgelegt wird, sagt Dokploys öffentliche
Dokumentation nicht — **nicht verifizierbar, also nicht als Tatsache
behandeln.** Praktisch heißt das: Dokploys UI bietet keinen nachweisbaren
Sicherheitsgewinn gegenüber einer selbst verwalteten `.env`-Datei, nur eine
andere Eingabemaske für dieselbe Ablageform.

**Deshalb: Dokploys Variablen-UI für die echten Secrets gar nicht benutzen.**
Stattdessen:

1. `.env` lokal pflegen (liegt bereits in `.gitignore`, verlässt die eigene
   Maschine nie unverschlüsselt außer per SSH).
2. Einmalig auf den VPS kopieren — SSH ist ohnehin verschlüsselter Transport,
   kein zusätzliches Werkzeug nötig:
   ```bash
   rsync -avP --chmod=600 .env <vps>:/pfad/zum/deployment-verzeichnis/.env
   ```
3. Auf dem VPS: `chmod 600 .env`, Eigentümer der Deploy-User, sonst niemand.
   Docker Compose lädt diese Datei automatisch, ganz ohne Dokploy-Konfiguration
   — genau der zweite, von Dokploys eigener Doku bestätigte Weg.
4. Rotation eines Secrets bedeutet: lokal neu generieren, Datei erneut
   `rsync`en, redeploy. Kein Live-Edit über die UI, wenn deren Weg ohnehin
   umgangen wird.

**Eine echte Verschlüsselung-bei-Ruhe, verifiziert:** Dokploy unterstützt
sechs externe Secret-Provider (HashiCorp Vault/OpenBao, Infisical, AWS
Secrets Manager, Doppler, Azure Key Vault, Scaleway Secret Manager) über die
Syntax `${{vault.<provider>.<pfad>:<feld>}}` — laut eigener Doku werden
diese Werte **"nie in der Dokploy-Datenbank gespeichert"**, sondern beim
Deploy vom Provider abgerufen und direkt injiziert. Für dieses Projekt
(ein VPS, eine handvoll Secrets, €27/Monat-Budget) ist ein zusätzlicher
Vault-Dienst voraussichtlich unverhältnismäßig — dieselbe Abwägung, die
CrowdSec-Alternativen wie Wazuh oder SafeLine schon aus Ressourcengründen
ausschließt (siehe `.claude/rules/security-and-governance.md`). Falls doch
gewünscht: **OpenBao** (Open-Source-Fork von Vault, keine Lizenzfrage —
dieselbe Überlegung wie Valkey statt Redis) oder **Infisical** (ebenfalls
quelloffen, selbst hostbar) passen besser zu diesem Projekt als eine
US-SaaS wie Doppler, aus denselben EU/Open-Source-Gründen wie der Rest des
Stacks.

**Nie:** Secrets ins Dockerfile backen, per `docker run -e SECRET=...` auf
einer geteilten Shell übergeben (landet in `docker inspect`/Shell-History),
oder in einen Chat/E-Mail/Ticket einfügen, um sie "kurz rüberzuschicken" —
die `.env`-Datei per `rsync` über SSH ist genauso schnell und verlässt nie
einen unverschlüsselten Kanal.

```bash
# Dokploy-Env
BUNNY_S3_ENDPOINT / BUNNY_BUCKET / BUNNY_ACCESS_KEY_ID / BUNNY_SECRET_ACCESS_KEY
IMAGE_BASE_URL=https://<pull-zone>.b-cdn.net
PMTILES_URL=https://<pull-zone>.b-cdn.net/basemap.pmtiles
NUXT_BEHIND_TRUSTED_PROXY=false        # bis Schritt 5 steht!
```

Redeploy ist zwingend, nicht nur ein Env-Wechsel: `mapAssetOrigins` und
`imageOrigin` in `nuxt.config.ts` werden **zur Buildzeit** aufgelöst, die CSP
nennt sonst den alten Host.

Prüfen: Karte laden, Konsole auf CSP-Verstöße ansehen, ein Site-Panel mit Foto
öffnen, `curl -I https://<image-host>/r/card/<key>` → 200, `image/webp`.

---

## 5. Origin-Firewall — erst danach `BEHIND_TRUSTED_PROXY=true`

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

## 6. CrowdSec-Bouncer

**Geändert seit der ersten Fassung dieses Runbooks: statt des
Traefik-Plugin-Bouncers unten gibt es jetzt `docker/security/bunny-bouncer/`,
als eigener Service in `docker/compose.prod.yml` bereits verdrahtet.** Grund
für den Wechsel: der Traefik-Bouncer blockt erst nach dem TLS-Handshake, also
auf dieser Maschine; der Bunny-Bouncer blockt an Bunnys Edge, bevor die
Anfrage die Box überhaupt erreicht — genau der Unterschied, den der
„Offen"-Abschnitt unten schon als Lücke benannt hatte. Die
Traefik-Plugin-Route bleibt unten dokumentiert (Alternative, keine Ergänzung —
nicht beide gleichzeitig betreiben), falls der Bunny-Weg aus irgendeinem Grund
verworfen wird.

CrowdSec ist zweigeteilt: die Engine _erkennt_ und schreibt eine Entscheidung,
ein _Bouncer_ liest sie und blockiert. Aktuell läuft nur die erste Hälfte —
`cscli decisions list` zeigt Bans, der Client wird weiter bedient.

### 6a. Was der Bunny-Bouncer tatsächlich braucht

Was er tut und warum, steht ausführlich im Kopfkommentar von
`docker/security/bunny-bouncer/bouncer.mjs` — hier nur der Deploy-Teil.

**Wichtig, weil oft missverstanden: der Bunny-Bouncer ersetzt weder Schritt 5
(Origin-Firewall) noch braucht er das Traefik-Plugin aus 6b.** Er ist
zusätzlich zu Schritt 5, nicht statt dessen — ohne die Hetzner-Firewall kann
ein Angreifer Bunny komplett umgehen und die Hetzner-IP direkt ansprechen,
womit jede Sperre, die der Bouncer bei Bunny setzt, wirkungslos wird. Das
Traefik-Plugin aus 6b wird durch den Bunny-Bouncer dagegen tatsächlich
überflüssig — beides zu betreiben blockt doppelt und verwaltet zwei
Entscheidungsquellen für dieselbe Sperre.

Neue Env-Variablen (zusätzlich zu denen aus Schritt 4):

```bash
CROWDSEC_BUNNY_BOUNCER_KEY=<eigener Key, unabhängig vom Traefik-Key>
BUNNY_API_KEY=<Bunny-Account-API-Key>
BUNNY_SITE_PULL_ZONE_ID=<Pull-Zone-ID vor SITE_HOST, NICHT die Bilder-Zone>
```

`CROWDSEC_BUNNY_BOUNCER_KEY` wird über `BOUNCER_KEY_bunny` auf dem
`crowdsec`-Service automatisch registriert — kein manuelles `cscli bouncers add`
nötig, anders als beim Traefik-Weg unten.

**Verifikation, bevor produktivem Traffic vertraut wird** — die Bunny-Enum-Werte
im Bouncer (`ActionType`, Trigger-`Type`, `PatternMatchingType`) stammen aus
Bunnys API-Referenz, nicht aus einem Test gegen einen echten Account:

```bash
docker exec vestigian-crowdsec-1 cscli decisions add --ip <test-ip> -d 2m
# 30–60s warten (POLL_INTERVAL_SECONDS), dann von <test-ip> aus, oder via Proxy:
curl -I https://<site-host>/                     # muss 403 liefern
docker exec vestigian-crowdsec-1 cscli decisions delete --all
# Bunny-Dashboard → Pull Zone → Edge Rules: die Regel "crowdsec-bouncer-managed"
# muss danach wieder leer/deaktiviert sein.
```

Schlägt der 403 fehl, im Bunny-Dashboard nachsehen, was die Regel tatsächlich
enthält, und `PatternMatchingType`/`Type` im Bouncer-Code danach korrigieren —
nicht raten, sondern gegen das beobachtete Verhalten anpassen.

### 6b. Traefik-Plugin-Bouncer (Alternative, aktuell nicht der gewählte Weg)

```bash
docker exec vestigian-crowdsec-1 cscli bouncers add traefik-bouncer
```

Dokploy UI → Traefik → **statische** Config: Plugin `crowdsec-bouncer-traefik-plugin`
registrieren. Dann dynamische Config: Middleware mit `crowdsecLapiHost: crowdsec:8080`
und dem Key. Zuletzt am App-Router anhängen:
`app-rate-limit@file,crowdsec@file`.

```bash
docker exec vestigian-crowdsec-1 cscli decisions add --ip <test-ip> -d 2m
curl -I https://<site-host>/                     # 403
docker exec vestigian-crowdsec-1 cscli decisions delete --all
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

0 → 1 → 2 → 3 → 4 → 5 → 6, einzeln deployen.

| Schritt      | Rollback                                                                                                                                                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Upload     | nichts zu tun, MinIO bleibt unangetastet                                                                                                                                                                                           |
| 2 Datenbank  | leeres `postgres-data`-Volume löschen und neu starten (nichts Produktives hat je darauf gelesen) — `docker compose down -v postgres && docker compose up -d postgres`, dann Restore erneut versuchen                               |
| 4 Deployment | Env zurück, redeploy                                                                                                                                                                                                               |
| 5 Firewall   | Regel löschen, `BEHIND_TRUSTED_PROXY=false`                                                                                                                                                                                        |
| 6 Bouncer    | `bunny-bouncer`-Service stoppen (`docker compose stop bunny-bouncer`); die Edge Rule bleibt liegen, aber deaktiviert sich selbst beim nächsten Zyklus nicht mehr — im Bunny-Dashboard manuell deaktivieren. Erkennung läuft weiter |

## Offen

- **Off-box-Backup der 15 GiB.** Bis Schritt 1 läuft, existieren sie einmal.
  Danach zweimal (lokal + Bunny), aber Bunny ist kein Backup, sondern
  Auslieferung. Das dringendste ungelöste Risiko.
- ~~Edge-Bouncer statt Traefik-Bouncer~~ — **erledigt**, siehe 6a. Offen bleibt
  nur die Verifikation der Bunny-Enum-Werte gegen den echten Account (Schritt
  6a, letzter Absatz) — ungetestet, weil aus dieser Umgebung kein Bunny-Account
  erreichbar ist.
- Bunny Shield im Dashboard aktivieren (Free-Tier: WAF + L7-DDoS) — zusätzlich
  zum Bouncer, nicht statt dessen: Shield deckt volumetrische L7-Floods breiter
  ab, der Bouncer setzt CrowdSecs eigene, aus den Anwendungslogs abgeleiteten
  Entscheidungen um.
- **Bunny-Pull-Zone vor `SITE_HOST`: "Override Cache Control" muss aus
  bleiben.** Die App sendet inzwischen für jede Route einen bewussten
  `cache-control` (Standard `private, no-store`, mit begründeten Ausnahmen für
  Kacheln, öffentliche Feeds usw. — `server/middleware/security-defaults.ts`,
  `nuxt.config.ts`s `routeRules`). Ist die Override-Option in der Pull Zone
  aktiviert, ignoriert Bunny das komplett und cached nach eigener TTL
  unabhängig vom Origin-Header — das würde `/api/me`, die Moderationsqueue
  oder einen DSGVO-Export (`auth/export.get.ts`) am Edge cachen und dem
  nächsten Besucher derselben URL ausliefern. Ungetestet aus dieser Umgebung,
  aus demselben Grund wie die Bunny-Enum-Werte oben — kein Bunny-Account
  erreichbar. Die Bild-Pull-Zone ist davon ausdrücklich ausgenommen: die ist
  über die imgproxy-URL, nicht über eine Session, adressiert und soll hart
  gecacht werden.
- **Lizenzanfrage Fundmünzen — zum Go-Live stellen.** AFE (RGK Frankfurt,
  afe@dainst.de) und das Portable Antiquities Scheme um eine ausdrückliche
  Lizenz für Einzelfundmünzen bitten. Bis dahin verlinkt die Site-Ansicht
  nur (`shared/utils/coin-find-databases.ts`). Mit Lizenz wird daraus ein
  Import nach CHRR-Vorbild — Fundorte nie genauer als die Quelle öffentlich
  zeigt, keine Findernamen. Stand und Begründung:
  `.claude/rules/antiquity-basemaps.md`, „Single coin finds".
