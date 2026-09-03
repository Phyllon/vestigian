#!/bin/sh
# One-command local setup: prerequisites check, .env with real secrets, the
# dev stack, and the database schema. It stops there deliberately — the
# vici.org import is a multi-hour crawl of someone else's server (see
# "Importing the vici.org data" in README.md) and has no business running
# unattended from a setup script.
set -eu

step() { printf '\n\033[1;34m==>\033[0m %s\n' "$1"; }
die() {
  printf '\033[1;31merror:\033[0m %s\n' "$1" >&2
  exit 1
}

step "Checking prerequisites"

command -v node >/dev/null 2>&1 || die "Node.js is required (>=22) — https://nodejs.org"
NODE_MAJOR=$(node -e 'process.stdout.write(process.versions.node.split(".")[0])')
[ "$NODE_MAJOR" -ge 22 ] || die "Node.js >=22 is required, found $(node --version)"

command -v pnpm >/dev/null 2>&1 || die "pnpm is required — https://pnpm.io/installation"
command -v docker >/dev/null 2>&1 || die "Docker is required — https://docs.docker.com/get-docker/"
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required (the 'docker compose' subcommand)"
command -v openssl >/dev/null 2>&1 || die "openssl is required to generate secrets"

echo "node $(node --version), pnpm $(pnpm --version), $(docker --version), $(docker compose version --short)"

step "Preparing .env"

if [ -f .env ]; then
  echo ".env already exists — leaving it untouched"
else
  cp .env.example .env

  SESSION_PASSWORD=$(openssl rand -base64 32)
  ALTCHA_SECRET=$(openssl rand -hex 32)

  # A generated secret can contain / and & — both are sed metacharacters, so
  # every replacement uses | as the delimiter instead of the more common /.
  sed -i.bak "s|^NUXT_SESSION_PASSWORD=.*|NUXT_SESSION_PASSWORD=${SESSION_PASSWORD}|" .env
  sed -i.bak "s|^NUXT_ALTCHA_SECRET=.*|NUXT_ALTCHA_SECRET=${ALTCHA_SECRET}|" .env
  rm -f .env.bak

  echo ".env created with a generated NUXT_SESSION_PASSWORD and NUXT_ALTCHA_SECRET"
  echo "Everything else in .env is a working default for local development."
fi

step "Installing dependencies"
pnpm install

step "Starting the dev stack (postgres+postgis, valkey, minio, imgproxy, mailpit)"
docker compose -f docker/compose.dev.yml up -d

# Not `up --wait`: it treats the compose file's one-shot bucket-bootstrap
# container (`minio-init`, which is supposed to exit 0 once the bucket
# exists) as a readiness failure, and does so non-deterministically — found
# by running this script repeatedly, not by reading the compose file. The
# only thing the next step actually needs is postgres, so wait for exactly
# that instead of every container's own idea of "ready".
step "Waiting for postgres"
until docker compose -f docker/compose.dev.yml exec -T postgres pg_isready -U vestigian >/dev/null 2>&1; do
  sleep 1
done

step "Applying the database schema"
pnpm db:migrate

step "Done"
cat <<'EOF'

The stack is up and the schema is applied. Next:

  pnpm dev              # http://localhost:3000 — the map runs on OpenFreeMap,
                         # no API key needed, but there is no site data yet

To populate it with real data, see "Importing the vici.org data" in
README.md — deliberately not part of this script.
EOF
