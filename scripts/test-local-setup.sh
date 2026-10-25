#!/usr/bin/env bash
# Real-Compose smoke test for the Dashboard local setup (#589/#610).
#
# Two-step lifecycle: generate a Dashboard WITHOUT uploads, provision PostgreSQL
# + schema + admin, then add the uploads module, evolve the managed Compose to
# add S3Mock and prove PostgreSQL data/credentials survive. The generated
# application's own /api/upload presign flow is exercised against S3Mock
# (authenticated), including Range GET, persistence across `docker compose down`
# + `up`, and DELETE. Requires Docker with the Compose plugin; disposable.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/sf-local-setup-XXXXXX")"
SF_PM="${SF_PM:-bun}"
APP_DIR="$TMP_DIR/app"
DEV_PID=""

cleanup() {
	[ -n "$DEV_PID" ] && kill "$DEV_PID" >/dev/null 2>&1 || true
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

echo "==> Generating a real Dashboard project without uploads"
cd "$TMP_DIR"
SVFORGE_BIN="$REPO_ROOT/packages/svforge/bin/svforge.mjs"
export SVFORGE_SV_CMD="${SV_CMD:-$REPO_ROOT/node_modules/.bin/sv}"
"$SVFORGE_BIN" create app --template dashboard --pm "$SF_PM" --modules dnd --yes --dev-root "$REPO_ROOT" \
	|| { echo "❌ svforge create failed"; exit 1; }
cd "$APP_DIR"

test ! -f docker-compose.yml || { echo "❌ scaffolding must not generate docker-compose.yml"; exit 1; }
if [ -f .env ]; then
	! grep -q '^SVFORGE_LOCAL_DB=' .env || { echo "❌ scaffolding must not provision a local database"; exit 1; }
	! grep -q '^POSTGRES_PASSWORD=' .env || { echo "❌ scaffolding must not generate database credentials"; exit 1; }
fi

echo "==> Provisioning PostgreSQL + schema (ambient DB vars must be ignored)"
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

echo "==> Creating the first administrator"
ADMIN_NAME='Smoke Admin' ADMIN_EMAIL='smoke@example.com' ADMIN_PASSWORD='smoke-password-123' \
	bash scripts/setup.sh --compose --admin >/dev/null || { echo "❌ admin bootstrap failed"; exit 1; }
admins="$(docker compose exec -T postgres psql -U svforge -d svforge -tAc "select count(*) from \"user\" where role = 'admin'")"
[ "$admins" = "1" ] || { echo "❌ expected exactly one administrator, got $admins"; exit 1; }

echo "==> Adding the uploads module later and evolving the managed Compose"
pg_env_before="$(grep -E '^(POSTGRES_PASSWORD|POSTGRES_PORT|DATABASE_URL|SVFORGE_LOCAL_DB)=' .env)"
postgres_block_before="$(sed -n '/^  postgres:/,/^volumes:/p' docker-compose.yml | sed '$d')"
"$REPO_ROOT/node_modules/.bin/sv" add "file:$REPO_ROOT/packages/uploads=testpack:no" --install "$SF_PM" --no-download-check --no-git-check \
	|| { echo "❌ adding the uploads module failed"; exit 1; }
grep -q '"uploads"' .svforge.json || { echo "❌ uploads module missing from .svforge.json"; exit 1; }
bash scripts/setup.sh --compose || { echo "❌ setup --compose (transition to S3) failed"; exit 1; }

grep -q 's3mock:5.2.3@sha256:' docker-compose.yml || { echo "❌ S3Mock is missing after adding uploads"; exit 1; }
grep -q 'postgres-data:/var/lib/postgresql/data' docker-compose.yml || { echo "❌ PostgreSQL volume was lost in the transition"; exit 1; }
postgres_block_after="$(sed -n '/^  postgres:/,/^  s3:/p' docker-compose.yml | sed '$d')"
[ "$postgres_block_after" = "$postgres_block_before" ] || { echo "❌ the PostgreSQL service block changed during the transition"; exit 1; }
pg_env_after="$(grep -E '^(POSTGRES_PASSWORD|POSTGRES_PORT|DATABASE_URL|SVFORGE_LOCAL_DB)=' .env)"
[ "$pg_env_after" = "$pg_env_before" ] || { echo "❌ PostgreSQL credentials/port/URL changed during the transition"; exit 1; }
admins_after_module="$(docker compose exec -T postgres psql -U svforge -d svforge -tAc "select count(*) from \"user\" where role = 'admin'")"
[ "$admins_after_module" = "1" ] || { echo "❌ the administrator row did not survive the Compose transition"; exit 1; }

s3_port="$(sed -n 's/^S3_PORT=//p' .env)"
s3_bucket="$(sed -n 's/^S3_BUCKET=//p' .env)"
grep -q "^S3_ENDPOINT=\"\?http://127.0.0.1:${s3_port}\"\?$" .env || { echo "❌ S3_ENDPOINT does not match S3_PORT"; exit 1; }
grep -q "^S3_BUCKET=${s3_bucket}$" .env || { echo "❌ S3_BUCKET missing"; exit 1; }
grep -q '^S3_FORCE_PATH_STYLE=true$' .env || { echo "❌ local S3 must use path-style addressing"; exit 1; }
[ -n "$s3_bucket" ] || { echo "❌ local S3 bucket is empty"; exit 1; }

echo "==> Exercising the generated app upload route against local S3"
cat > s3-smoke.mjs <<'JS'
import { readFileSync } from 'node:fs';
import { S3Client, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').map((line) => /^([A-Z0-9_]+)=(.*)$/.exec(line)).filter(Boolean).map((m) => [m[1], m[2]]));
const s3 = new S3Client({
	endpoint: env.S3_ENDPOINT,
	region: env.S3_REGION || 'us-east-1',
	forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
	credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
});
const Bucket = env.S3_BUCKET;
const Key = readFileSync('.s3-key', 'utf8').trim();
const [action] = process.argv.slice(2);
if (action === 'head') {
	await s3.send(new HeadObjectCommand({ Bucket, Key }));
	await s3.send(new GetObjectCommand({ Bucket, Key, Range: 'bytes=0-9' })).then(async (res) => {
		const body = await res.Body.transformToString();
		if (body.length !== 10) throw new Error(`unexpected ranged body length: ${body.length}`);
	});
	console.log('s3-head-range-ok');
} else if (action === 'get') {
	const res = await s3.send(new GetObjectCommand({ Bucket, Key }));
	const body = await res.Body.transformToString();
	if (body.length !== 100) throw new Error(`object did not survive restart (${body.length} bytes)`);
	console.log('s3-get-ok');
} else if (action === 'delete') {
	await s3.send(new DeleteObjectCommand({ Bucket, Key }));
	try {
		await s3.send(new HeadObjectCommand({ Bucket, Key }));
		throw new Error('object still readable after delete');
	} catch (error) {
		if (error?.$metadata?.httpStatusCode !== 404) throw error;
	}
	console.log('s3-delete-ok');
}
JS
cat > app-upload.mjs <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
const presign = JSON.parse(readFileSync('presign.json', 'utf8'));
if (!presign.url || !presign.fields || !presign.key) throw new Error('unexpected presign response');
const form = new FormData();
for (const [name, value] of Object.entries(presign.fields)) form.append(name, value);
form.append('file', new Blob([Buffer.alloc(100, 1)], { type: 'image/png' }), 'upload');
const response = await fetch(presign.url, { method: 'POST', body: form });
if (!response.ok) throw new Error(`S3 upload failed: ${response.status} ${await response.text()}`);
writeFileSync('.s3-key', presign.key);
console.log('app-upload-ok');
JS

APP_PORT=5199
ORIGIN="http://127.0.0.1:${APP_PORT}"
# SvelteKit CSRF and Better Auth only trust this origin in development.
sed -i.bak "s|^ORIGIN=.*|ORIGIN=\"${ORIGIN}\"|" .env
bun run dev -- --host 127.0.0.1 --port "$APP_PORT" >/tmp/sf-local-dev.log 2>&1 &
DEV_PID=$!
ready=""
for _ in $(seq 1 90); do
	curl -fsS "${ORIGIN}/login" >/dev/null 2>&1 && { ready=1; break; }
	sleep 1
done
[ -n "$ready" ] || { echo "❌ dev server never became ready"; tail -20 /tmp/sf-local-dev.log; exit 1; }
curl -fsS -c /tmp/sf-local-cookies -H "origin: ${ORIGIN}" -H 'content-type: application/json' \
	-d '{"email":"smoke@example.com","password":"smoke-password-123"}' \
	"${ORIGIN}/api/auth/sign-in/email" >/dev/null \
	|| { echo "❌ admin sign-in against the generated app failed"; exit 1; }
curl -fsS -b /tmp/sf-local-cookies -H "origin: ${ORIGIN}" -H 'content-type: application/json' \
	-d '{"filename":"avatar.png","contentType":"image/png","size":100}' \
	"${ORIGIN}/api/upload" > presign.json \
	|| { echo "❌ /api/upload presign failed"; exit 1; }
bun app-upload.mjs || { echo "❌ generated app upload flow failed"; exit 1; }
bun s3-smoke.mjs head || { echo "❌ uploaded object is not readable with Range"; exit 1; }
kill "$DEV_PID" >/dev/null 2>&1 || true
DEV_PID=""

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

echo "==> Stopping and restarting keeps the named volumes"
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
bun s3-smoke.mjs get || { echo "❌ uploaded S3 object did not survive docker compose down/up"; exit 1; }
bun s3-smoke.mjs delete || { echo "❌ local S3 DELETE failed"; exit 1; }

echo "✅ Local Dashboard setup validated with real Docker Compose/PostgreSQL/S3Mock (two-step evolution + app upload flow)."
