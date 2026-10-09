import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const DASHBOARD = 'packages/svforge/templates/dashboard';

const AUTH = join(ROOT, DASHBOARD, 'src/lib/server/auth.ts');
const SIGNUP_MODE = join(ROOT, DASHBOARD, 'src/lib/server/signup-mode.ts');
const FIRST_ADMIN = join(ROOT, DASHBOARD, 'src/lib/server/first-admin.ts');
const ADMIN = join(ROOT, DASHBOARD, 'src/lib/server/admin.ts');
const ADMIN_USERS = join(ROOT, DASHBOARD, 'src/lib/server/admin-users.ts');
const AUTH_SCHEMA = join(ROOT, DASHBOARD, 'src/lib/server/db/auth.schema.ts');
const CLIENT = join(ROOT, DASHBOARD, 'src/lib/server/db/client.ts');
const SETUP_SERVER = join(ROOT, DASHBOARD, 'src/routes/setup/+page.server.ts');
const CREATE_ADMIN = join(ROOT, DASHBOARD, 'root/scripts/create-admin.ts');
const ENV_EXAMPLE = join(ROOT, DASHBOARD, 'root/.env.example');
const PACKAGE_README = join(ROOT, 'packages/svforge/README.md');
const SCAFFOLD_AGENTS = join(ROOT, 'packages/svforge/src/scaffolded-agents.ts');

const read = (path: string) => readFileSync(path, 'utf-8');

/**
 * #318 — Close sign-up and secure the admin bootstrap (P0).
 *
 * The removed model combined two dangerous behaviors: public email/password
 * sign-up + "oldest user (createdAt) is admin". On an empty database an
 * anonymous sign-up could therefore create THE administrator. These guards
 * pin the replacement model at the template source level; the behavioral
 * proofs live in the dashboard template suite (first-admin.test.ts and
 * signup-mode.test.ts run against real PostgreSQL in the scaffold gate).
 */
describe('sign-up policy is server-side and fails closed (#318)', () => {
	it('sign-up is disabled when the mode is closed — the DEFAULT', () => {
		const auth = read(AUTH);
		expect(auth).toMatch(/resolveSignupMode\(env\.SIGNUP_MODE\)/);
		expect(auth).toMatch(/disableSignUp:\s*signupMode === 'closed'/);
		// closed is the fail-closed default of the resolver itself
		expect(read(SIGNUP_MODE)).toMatch(/DEFAULT_SIGNUP_MODE: SignupMode = 'closed'/);
	});

	it('unknown mode values fail closed in the resolver (behavioral import)', async () => {
		const { resolveSignupMode, SIGNUP_MODES } =
			await import('../packages/svforge/templates/dashboard/src/lib/server/signup-mode');
		expect(resolveSignupMode(undefined)).toBe('closed');
		expect(resolveSignupMode('')).toBe('closed');
		expect(resolveSignupMode('OPEN_TO_EVERYONE')).toBe('closed');
		expect(resolveSignupMode('closed')).toBe('closed');
		expect(resolveSignupMode('invite-only')).toBe('invite-only');
		expect(resolveSignupMode('self-service')).toBe('self-service');
		expect(SIGNUP_MODES).toEqual(['closed', 'invite-only', 'self-service']);
	});

	it('invite-only mode is enforced by a server-side hook, not the UI', () => {
		const auth = read(AUTH);
		expect(auth).toMatch(/signupMode === 'invite-only'/);
		expect(auth).toMatch(/user:\s*\{\s*create:\s*\{\s*before/);
		expect(auth).toMatch(/findValidInvitation/);
		expect(auth).toMatch(/acceptInvitation/);
	});

	it('the three modes are documented in user guidance and .env.example', () => {
		for (const file of [ENV_EXAMPLE, PACKAGE_README]) {
			const doc = read(file);
			expect(doc, file).toMatch(/closed/);
			expect(doc, file).toMatch(/invite-only/);
			expect(doc, file).toMatch(/self-service/);
		}
	});
});

describe('the admin role is explicit and persisted (#318)', () => {
	it('the user table carries a role column defaulting to user', () => {
		const schema = read(AUTH_SCHEMA);
		expect(schema).toMatch(/role:\s*text\('role'\)\.notNull\(\)\.default\('user'\)/);
	});

	it('isAdmin checks the persisted role — never row ordering', () => {
		const admin = read(ADMIN);
		expect(admin).toMatch(/role === ADMIN_ROLE/);
		expect(admin).not.toMatch(/orderBy/);
		expect(admin).not.toMatch(/asc\(/);
	});

	it('no template source derives authorization from createdAt ordering', () => {
		for (const file of [ADMIN, FIRST_ADMIN, SETUP_SERVER]) {
			const src = read(file)
				.replace(/\/\*[\s\S]*?\*\//g, '')
				.replace(/\/\/.*$/gm, '');
			expect(src, file).not.toMatch(/orderBy\(\s*asc\(user\.createdAt\)\s*\)/);
		}
	});

	it('admin-created users are ALWAYS plain users (defense in depth)', () => {
		expect(read(ADMIN_USERS)).toMatch(/role:\s*'user'/);
	});
});

describe('first-admin bootstrap is atomic and controlled (#318)', () => {
	it('the bootstrap verifies NO admin inside a transaction-scoped advisory lock', () => {
		const bootstrap = read(FIRST_ADMIN);
		expect(bootstrap).toMatch(/pg_advisory_xact_lock/);
		expect(bootstrap).toMatch(/db\.transaction/);
		// the no-admin check happens after the lock, inside the same transaction
		const lockIdx = bootstrap.indexOf('pg_advisory_xact_lock');
		const checkIdx = bootstrap.indexOf('await adminExists(tx)');
		const insertIdx = bootstrap.indexOf('await tx.insert(user)');
		expect(lockIdx).toBeGreaterThan(-1);
		expect(checkIdx).toBeGreaterThan(lockIdx);
		expect(insertIdx).toBeGreaterThan(checkIdx);
		expect(bootstrap).toMatch(/AdminExistsError/);
	});

	it('the operator command and the dev-only /setup route share the same bootstrap', () => {
		const setup = read(SETUP_SERVER);
		expect(setup).toMatch(/bootstrapFirstAdmin\(db,/);
		expect(setup).toMatch(/AdminExistsError/);
		// the dev gate is server-side, never UI-only
		expect(setup).toMatch(/if \(!dev\)/);

		const cli = read(CREATE_ADMIN);
		expect(cli).toMatch(/bootstrapFirstAdmin/);
		expect(cli).toMatch(/AdminExistsError/);
	});

	it('the bootstrap command is delivered at the project root and exposed as a script', () => {
		expect(read(CLIENT)).toMatch(/export function createDb/);
		// client.ts must stay SvelteKit-free so the CLI can import the factory
		expect(read(CLIENT)).not.toMatch(/\$env\//);
		const mode = read(join(ROOT, 'packages/svforge/src/modes/dashboard.ts'));
		// #325: the runner is PM-aware (bun runs the TS script natively, other
		// package managers get tsx through their dlx runner) — the script must
		// stay exposed and point at the delivered create-admin.ts.
		expect(mode).toMatch(/'admin:create':\s*`\$\{runTs\} scripts\/create-admin\.ts`/);
	});
});

describe('generated instructions teach the new model (#318)', () => {
	it('no first-user-is-admin instruction survives anywhere', () => {
		const stale = [
			join(ROOT, 'packages/svforge/AGENTS.md'),
			SCAFFOLD_AGENTS,
			join(ROOT, DASHBOARD, 'root/scripts/setup.sh'),
			join(ROOT, 'scripts/test-scaffold.sh')
		];
		for (const file of stale) {
			const doc = read(file);
			expect(doc.toLowerCase(), file).not.toMatch(/first.user(.is|.becomes|=).admin/);
			expect(doc, file).not.toMatch(/premier utilisateur devient automatiquement administrateur/);
		}
	});

	it('the generated AGENTS.md documents modes, bootstrap and the explicit role', () => {
		const agents = read(SCAFFOLD_AGENTS);
		expect(agents).toMatch(/SIGNUP_MODE/);
		expect(agents).toMatch(/admin:create/);
		expect(agents).toMatch(/user\.role/);
		expect(agents).toMatch(/invite-only/);
		expect(agents).toMatch(/self-service/);
	});
});
