export const DASHBOARD_CI_WORKFLOW_PATH = '/.github/workflows/ci.yml';

const SUPPORTED_PACKAGE_MANAGERS = ['bun', 'npm', 'pnpm', 'yarn'] as const;
type SupportedPackageManager = (typeof SUPPORTED_PACKAGE_MANAGERS)[number];

interface DashboardCiCommands {
	setup: string;
	install: string;
	drizzle: string;
	run: string;
}

function parsePackageManager(packageManager: string): { name: SupportedPackageManager; version?: string } {
	const [requestedName, requestedVersion] = packageManager.trim().split('@', 2);
	const name = SUPPORTED_PACKAGE_MANAGERS.includes(requestedName as SupportedPackageManager)
		? (requestedName as SupportedPackageManager)
		: 'npm';
	const version = requestedVersion && /^\d+(?:\.\d+){0,2}$/.test(requestedVersion) ? requestedVersion : undefined;
	return { name, version };
}

function resolveDashboardCiCommands(packageManager: string): DashboardCiCommands {
	const { name, version } = parsePackageManager(packageManager);
	if (name === 'bun') {
		return {
			setup: `      - name: Setup Bun\n        uses: oven-sh/setup-bun@v2\n        with:\n          bun-version: ${version ?? '1.3.14'}`,
			install: 'bun install --frozen-lockfile',
			drizzle: 'bunx drizzle-kit push --force',
			run: 'bun run'
		};
	}

	if (name === 'pnpm') {
		return {
			setup: `      - name: Setup pnpm\n        uses: pnpm/action-setup@v4\n        with:\n          version: ${version ?? '10'}\n\n      - name: Setup Node\n        uses: actions/setup-node@v4\n        with:\n          node-version: 22\n          cache: pnpm`,
			install: 'pnpm install --frozen-lockfile',
			drizzle: 'pnpm exec drizzle-kit push --force',
			run: 'pnpm run'
		};
	}

	if (name === 'yarn') {
		const yarnMajor = Number(version?.split('.')[0]);
		const immutableInstall = yarnMajor >= 2 ? '--immutable' : '--frozen-lockfile';
		return {
			setup: `      - name: Setup Node\n        uses: actions/setup-node@v4\n        with:\n          node-version: 22\n\n      - name: Enable Yarn\n        run: corepack enable\n\n      - name: Activate Yarn\n        run: corepack prepare yarn@${version ?? '1.22.22'} --activate`,
			install: `yarn install ${immutableInstall}`,
			drizzle: 'yarn run drizzle-kit push --force',
			run: 'yarn run'
		};
	}

	return {
		setup: `      - name: Setup Node\n        uses: actions/setup-node@v4\n        with:\n          node-version: 22\n          cache: npm`,
		install: 'npm ci',
		drizzle: 'npx --no-install drizzle-kit push --force',
		run: 'npm run'
	};
}

/** Render the package-manager placeholders in the generated dashboard CI workflow. */
export function renderDashboardCiWorkflow(template: string, packageManager: string): string {
	const commands = resolveDashboardCiCommands(packageManager);
	const replacements: Record<string, string> = {
		'{{PACKAGE_MANAGER_SETUP}}': commands.setup,
		'{{INSTALL_COMMAND}}': commands.install,
		'{{DRIZZLE_COMMAND}}': commands.drizzle,
		'{{CHECK_COMMAND}}': `${commands.run} check`,
		'{{TEST_COMMAND}}': `${commands.run} test`,
		'{{BUILD_COMMAND}}': `${commands.run} build`
	};
	let workflow = template;
	for (const [placeholder, replacement] of Object.entries(replacements)) {
		if (!workflow.includes(placeholder)) {
			throw new Error(`Dashboard CI template is missing ${placeholder}.`);
		}
		workflow = workflow.replace(placeholder, replacement);
	}
	return workflow;
}
