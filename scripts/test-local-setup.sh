#!/usr/bin/env bash
# Real-Compose smoke test for the Dashboard local setup (#589).
#
# Generates a real Dashboard project, provisions the project-managed PostgreSQL
# through Docker Compose, initializes the schema with db:push, and proves that a
# rerun and a stop/start cycle preserve the generated credentials, container and
# data. Requires Docker with the Compose plugin; uses a disposable project and
# removes its container + volume on exit.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/sf-local-setup-XXXXXX")"
SF_PM="${SF_PM:-bun}"
APP_DIR="$TMP_DIR/app"

cleanup() {
	if [ -f "$APP_DIR/docker-compose.yml" ]; then
		(cd "$APP_DIR" && docker compose down -v >/dev/null 2>&1) || true
	fi
	chmod -R u+w "$TMP_DIR" 2>/dev/null || true
	rm -rf "$TMP_DIR" 2>/dev/null || true
}
trap cleanup EXIT

command -v docker >/dev/null 2>&1 || { echo "❌ Docker is required for this smoke test"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "❌ Docker Compose is required for this smoke test"; exit 1; }

echo "==> Building svforge"
(cd "$REPO_ROOT/packages/svforge" && bun run build >/dev/null)

echo "==> Generating a real Dashboard project"
cd "$TMP_DIR"
SVFORGE_BIN="$REPO_ROOT/packages/svforge/bin/svforge.mjs"
export SVFORGE_SV_CMD="${SV_CMD:-$REPO_ROOT/node_modules/.bin/sv}"
"$SVFORGE_BIN" create app --template dashboard --pm "$SF_PM" --modules uploads --yes --dev-root "$REPO_ROOT" \
	|| { echo "❌ svforge create failed"; exit 1; }
cd "$APP_DIR"

test ! -f docker-compose.yml || { echo "❌ scaffolding must not generate docker-compose.yml"; exit 1; }
if [ -f .env ]; then
	! grep -q '^SVFORGE_LOCAL_DB=' .env || { echo "❌ scaffolding must not provision a local database"; exit 1; }
	! grep -q '^POSTGRES_PASSWORD=' .env || { echo "❌ scaffolding must not generate database credentials"; exit 1; }
fi

echo "==> Provisioning the local Compose database and schema (ambient DB vars must be ignored)"
DATABASE_URL='postgres://evil:evil@remote.example.com:5432/production' \
TEST_DATABASE_URL='postgres://evil:evil@remote.example.com:5432/production_test' \
	bash scripts/setup.sh --compose --init-schema || { echo "❌ setup --compose --init-schema failed"; exit 1; }

test -f docker-compose.yml || { echo "❌ docker-compose.yml missing"; exit 1; }
test -f .env || { echo "❌ .env missing"; exit 1; }
[ "$(stat -c %a .env 2>/dev/null || stat -f %Lp .env)" = "600" ] || { echo "❌ .env is not mode 600"; exit 1; }
grep -q '127.0.0.1:${POSTGRES_PORT' docker-compose.yml || { echo "❌ compose port is not loopback-bound"; exit 1; }
grep -q 'image: postgres:17' docker-compose.yml || { echo "❌ compose image is not pinned to PostgreSQL 17"; exit 1; }
grep -q '^/\.env$' .gitignore || { echo "❌ .env is not Git-ignored"; exit 1; }
! git -C . ls-files --cached -- .env | grep -q . || { echo "❌ .env is tracked by Git"; exit 1; }

password="$(sed -n 's/^POSTGRES_PASSWORD=//p' .env)"
[ "${#password}" -ge 32 ] || { echo "❌ generated PostgreSQL password is too short"; exit 1; }
grep -q "postgres://svforge:${password}@127.0.0.1:" .env || { echo "❌ DATABASE_URL does not match the generated Compose credentials"; exit 1; }

echo "==> Verifying the schema reached the Compose database"
tables="$(docker compose exec -T postgres psql -U svforge -d svforge -tAc "select count(*) from information_schema.tables where table_schema='public' and table_name in ('user','task','invitation')")"
[ "$tables" -ge 3 ] || { echo "❌ db:push did not create the expected schema (found $tables of 3 tables)"; exit 1; }

echo "==> Creating the first administrator and treating a rerun as a no-op"
ADMIN_NAME='Smoke Admin' ADMIN_EMAIL='smoke@example.com' ADMIN_PASSWORD='smoke-password-123' \
	bash scripts/setup.sh --compose --admin >/dev/null || { echo "❌ admin bootstrap failed"; exit 1; }
admins="$(docker compose exec -T postgres psql -U svforge -d svforge -tAc "select count(*) from \"user\" where role = 'admin'")"
[ "$admins" = "1" ] || { echo "❌ expected exactly one administrator, got $admins"; exit 1; }
ADMIN_NAME='Smoke Admin' ADMIN_EMAIL='smoke@example.com' ADMIN_PASSWORD='smoke-password-123' \
	bash scripts/setup.sh --compose --admin >/dev/null || { echo "❌ admin rerun failed"; exit 1; }
admins_after="$(docker compose exec -T postgres psql -U svforge -d svforge -tAc "select count(*) from \"user\" where role = 'admin'")"
[ "$admins_after" = "1" ] || { echo "❌ admin rerun changed the administrator"; exit 1; }

echo "==> Verifying the local S3 service from the generated app"
grep -q 's3mock:5.2.3@sha256:' docker-compose.yml || { echo "❌ S3Mock is missing from docker-compose.yml"; exit 1; }
s3_port="$(sed -n 's/^S3_PORT=//p' .env)"
s3_bucket="$(sed -n 's/^S3_BUCKET=//p' .env)"
grep -q "^S3_ENDPOINT=\"\?http://127.0.0.1:${s3_port}\"\?$" .env || { echo "❌ S3_ENDPOINT does not match S3_PORT"; exit 1; }
grep -q "^S3_BUCKET=${s3_bucket}$" .env || { echo "❌ S3_BUCKET missing"; exit 1; }
grep -q '^S3_FORCE_PATH_STYLE=true$' .env || { echo "❌ local S3 must use path-style addressing"; exit 1; }

cat > s3-smoke.mjs <<'JS'
import { readFileSync } from 'node:fs';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').map((line) => /^([A-Z0-9_]+)=(.*)$/.exec(line)).filter(Boolean).map((m) => [m[1], m[2]]));
const s3 = new S3Client({
	endpoint: env.S3_ENDPOINT,
	region: env.S3_REGION || 'us-east-1',
	forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
	credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
});
const [action] = process.argv.slice(2);
const Bucket = env.S3_BUCKET;
const Key = 'smoke/object.txt';
if (action === 'put') {
	await s3.send(new PutObjectCommand({ Bucket, Key, Body: 'hello-svforge', ContentType: 'text/plain' }));
	console.log('s3-put-ok');
} else if (action === 'range') {
	const res = await s3.send(new GetObjectCommand({ Bucket, Key, Range: 'bytes=0-4' }));
	const body = await res.Body.transformToString();
	if (body !== 'hello') throw new Error(`unexpected ranged body: ${body}`);
	console.log('s3-range-ok');
} else if (action === 'get') {
	const res = await s3.send(new GetObjectCommand({ Bucket, Key }));
	const body = await res.Body.transformToString();
	if (body !== 'hello-svforge') throw new Error(`object did not survive restart: ${body}`);
	console.log('s3-get-ok');
} else if (action === 'delete') {
	await s3.send(new DeleteObjectCommand({ Bucket, Key }));
	try {
		await s3.send(new GetObjectCommand({ Bucket, Key }));
		throw new Error('object still readable after delete');
	} catch (error) {
		if (error?.name !== 'NoSuchKey' && error?.$metadata?.httpStatusCode !== 404) throw error;
	}
	console.log('s3-delete-ok');
}
JS
bun s3-smoke.mjs put || { echo "❌ local S3 PUT failed"; exit 1; }
bun s3-smoke.mjs range || { echo "❌ local S3 Range GET failed"; exit 1; }

echo "==> Rerunning setup preserves credentials and does not reinitialize data"
env_before="$(cat .env)"
container_before="$(docker compose ps -q postgres)"
bash scripts/setup.sh --compose >/dev/null || { echo "❌ rerun failed"; exit 1; }
[ "$(cat .env)" = "$env_before" ] || { echo "❌ rerun changed .env credentials"; exit 1; }
[ "$(docker compose ps -q postgres)" = "$container_before" ] || { echo "❌ rerun recreated the PostgreSQL container"; exit 1; }

echo "==> Refusing a DATABASE_URL that no longer matches the managed database"
cp .env .env.saved
sed -i.bak 's/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=rotated-outside-setup-0000000000000000/' .env
if bash scripts/setup.sh --init-schema >/tmp/sf-local-mismatch.log 2>&1; then
	echo "❌ setup accepted a mismatched DATABASE_URL password"; exit 1
fi
grep -q 'password does not match' /tmp/sf-local-mismatch.log || { echo "❌ mismatch refusal was not actionable"; exit 1; }
mv .env.saved .env

echo "==> Refusing an altered Compose definition"
cp docker-compose.yml docker-compose.yml.saved
sed -i.bak 's/image: postgres:17.2/image: postgres:16/' docker-compose.yml
if bash scripts/setup.sh --init-schema >/tmp/sf-local-tampered.log 2>&1; then
	echo "❌ setup accepted an altered Compose file"; exit 1
fi
grep -q 'differs from the canonical SVForge-managed Compose document' /tmp/sf-local-tampered.log || { echo "❌ Compose tampering was not detected"; exit 1; }
mv docker-compose.yml.saved docker-compose.yml

echo "==> Refusing Compose overrides and ambient Compose controls"
echo 'services: {}' > docker-compose.override.yml
if bash scripts/setup.sh --init-schema >/tmp/sf-local-override.log 2>&1; then
	echo "❌ setup accepted docker-compose.override.yml"; exit 1
fi
grep -q 'unexpected Compose override files' /tmp/sf-local-override.log || { echo "❌ override refusal was not actionable"; exit 1; }
rm docker-compose.override.yml
if COMPOSE_PROJECT_NAME=hostile bash scripts/setup.sh --init-schema >/tmp/sf-local-control.log 2>&1; then
	echo "❌ setup accepted an ambient COMPOSE_PROJECT_NAME"; exit 1
fi
grep -q 'ambient Compose controls' /tmp/sf-local-control.log || { echo "❌ Compose control refusal was not actionable"; exit 1; }

echo "==> Stopping and restarting keeps the named volume"
docker compose down >/dev/null
docker compose up -d postgres s3 >/dev/null
for _ in $(seq 1 60); do
	docker compose exec -T postgres pg_isready -U svforge -d svforge >/dev/null 2>&1 && break
	sleep 1
done
for _ in $(seq 1 60); do
	docker compose exec -T s3 wget -q -O /dev/null http://127.0.0.1:9090/ >/dev/null 2>&1 && break
	sleep 1
done
rows="$(docker compose exec -T postgres psql -U svforge -d svforge -tAc 'select count(*) from "user"')"
[ "$rows" = "1" ] || { echo "❌ expected the administrator row to survive, got $rows rows"; exit 1; }
bun s3-smoke.mjs get || { echo "❌ S3 object did not survive docker compose down/up"; exit 1; }
bun s3-smoke.mjs delete || { echo "❌ local S3 DELETE failed"; exit 1; }

echo "✅ Local Dashboard setup validated with real Docker Compose/PostgreSQL."
