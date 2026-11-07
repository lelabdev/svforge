import { describe, expect, it } from 'vitest';
import type { SvApi } from 'sv';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { applyDashboardMode } from '../packages/svforge/src/modes/dashboard';
import { seedOfficialFoundationOnDisk } from './helpers/official-foundation';
import { baseFiles, dashboardFiles, dashboardRootFiles } from '../packages/svforge/src/templates';
import { importGenerated } from './helpers/generated-module';

type FilesystemSv = {
	root: string;
	dependency: (name: string, version: string) => void;
	devDependency: (name: string, version: string) => void;
	file: (path: string, transform: (content: string) => string) => void;
};

function filesystemSv(root: string): FilesystemSv {
	return {
		root,
		dependency() {},
		devDependency() {},
		file(path, transform) {
			const destination = join(root, path);
			mkdirSync(dirname(destination), { recursive: true });
			const current = (() => {
				try {
					return readFileSync(destination, 'utf8');
				} catch {
					return path === 'package.json' ? '{"scripts":{}}' : '';
				}
			})();
			writeFileSync(destination, transform(current));
		}
	};
}

const asSvApi = (sv: FilesystemSv): SvApi => sv as unknown as SvApi;

function compileComponent(source: string, filename: string): string {
	return compile(source, { filename, generate: 'server' }).js.code;
}

async function renderAdminDashboard(project: string, locale: 'fr' | 'en'): Promise<string> {
	const renderDir = join(project, `.render-${locale}`);
	mkdirSync(renderDir, { recursive: true });

	const messages = JSON.parse(readFileSync(join(project, 'messages', `${locale}.json`), 'utf8')) as Record<string, string>;
	// Paraglide messages are functions taking params — mirror that contract so
	// interpolated copy (e.g. the welcome headline) renders like production.
	const messageFunction = (key: string, value: string) => {
		const parts = value.split(/\{(\w+)\}/g);
		const expression = parts
			.map((part, index) => (index % 2 === 1 ? `(params?.${part} ?? '')` : JSON.stringify(part)))
			.join(' + ');
		return `export const ${key} = (params) => ${expression};`;
	};
	writeFileSync(
		join(renderDir, 'messages.js'),
		Object.entries(messages)
			.filter(([key]) => key !== '$schema')
			.map(([key, value]) => messageFunction(key, value))
			.join('\n')
	);
	writeFileSync(join(renderDir, 'cn.js'), 'export const cn = (...classes) => classes.filter(Boolean).join(" ");');
	// #588: the shells localize their navigation; the harness renders English,
	// where the base locale is unprefixed.
	writeFileSync(
		join(renderDir, 'runtime.js'),
		`export const getLocale = () => 'en';
export const deLocalizeUrl = (url) => new URL(url);
export const localizeHref = (href) => href;
export const locales = ['en', 'fr'];`
	);
	writeFileSync(
		join(renderDir, 'Empty.js'),
		compileComponent('<script>let { children } = $props();</script>{@render children?.()}', 'Empty.svelte')
	);

	const layout = readFileSync(
		join(project, 'src/lib/components/svforge/layout/AdminLayout.svelte'),
		'utf8'
	)
		.replace(/^\s*import\s[^;]*;\s*$/gm, '')
		.replace(
			'<script lang="ts">',
			`<script lang="ts">
	import * as m from './messages.js';
	import { cn } from './cn.js';
	import Empty from './Empty.js';
	const Users = Empty, Gear = Empty, ChartBar = Empty, SignOut = Empty, Menu = Empty, X = Empty, SquaresFour = Empty, CaretDoubleLeft = Empty, CaretDoubleRight = Empty, ThemeToggle = Empty, LocaleSwitcher = Empty, AvatarInitial = Empty, Button = Empty, Portal = Empty;
	import { deLocalizeUrl, localizeHref } from './runtime.js';
	const Dialog = Object.assign(Empty, { Trigger: Empty, Backdrop: Empty, Positioner: Empty, Content: Empty, Title: Empty, CloseTrigger: Empty });`
		);
	const page = readFileSync(join(project, 'src/routes/(app)/admin/+page.svelte'), 'utf8')
		.replace(/^\s*import\s[^;]*;\s*$/gm, '')
		.replace(
			'<script lang="ts">',
			`<script lang="ts">
	import * as m from './messages.js';
	import { cn } from './cn.js';
	import Empty from './Empty.js';
	import PageHeader from './PageHeader.js';
	const Card = Empty, AvatarInitial = Empty, Badge = Empty, Button = Empty, Users = Empty, ChartBar = Empty, Clock = Empty;
	import { localizeHref } from './runtime.js';`
		);
	// The canonical page header (#601) is rendered for REAL — the page title and
	// its description are owned by that component, not by the route markup.
	const pageHeader = readFileSync(
		join(project, 'src/lib/components/svforge/layout/PageHeader.svelte'),
		'utf8'
	)
		.replace(/^\s*import\s[^;]*;\s*$/gm, '')
		.replace('<script lang="ts">', `<script lang="ts">
	import { cn } from './cn.js';`);

	writeFileSync(join(renderDir, 'PageHeader.js'), compileComponent(pageHeader, 'PageHeader.svelte'));

	writeFileSync(join(renderDir, 'AdminLayout.js'), compileComponent(layout, 'AdminLayout.svelte'));
	writeFileSync(join(renderDir, 'AdminPage.js'), compileComponent(page, 'AdminPage.svelte'));
	const app = `<script>
	import AdminLayout from './AdminLayout.js';
	import AdminPage from './AdminPage.js';
	const data = { user: { name: 'Ada', email: 'ada@example.com' }, stats: { totalUsers: 1, activeSessions: 1, newThisWeek: 1 }, recentUsers: [] };
</script>
<AdminLayout currentPath="/admin" {data}>
	{#snippet children()}<AdminPage {data} />{/snippet}
</AdminLayout>`;
	writeFileSync(join(renderDir, 'App.js'), compileComponent(app, 'App.svelte'));

	const { default: App } = await importGenerated(join(renderDir, 'App.js'));
	return render(App).body;
}

describe('dashboard admin composition', () => {
	it('overrides the base prerender default to keep dashboard routes dynamic', () => {
		const project = mkdtempSync(join(process.cwd(), '.svforge-dashboard-prerender-'));
		try {
			const sv = filesystemSv(project);
			seedOfficialFoundationOnDisk(project);
			applyDashboardMode(asSvApi(sv), baseFiles, dashboardFiles, 'vitest', dashboardRootFiles);

			const routeConfig = readFileSync(join(project, 'src/routes/+layout.ts'), 'utf8');
			expect(routeConfig).toMatch(/export const prerender = false/);
		} finally {
			rmSync(project, { recursive: true, force: true });
		}
	});

	it('scaffolds and renders a shell title before a welcome page header (#636)', async () => {
		const project = mkdtempSync(join(process.cwd(), '.svforge-dashboard-composition-'));
		try {
			const sv = filesystemSv(project);
			seedOfficialFoundationOnDisk(project);
			applyDashboardMode(asSvApi(sv), baseFiles, dashboardFiles, 'vitest', dashboardRootFiles);

			for (const [locale, shellTitle, navLabel, welcome, totalLabel] of [
				['en', 'Admin', 'Dashboard', 'Welcome back, Ada', 'Total Users'],
				['fr', 'Admin', 'Tableau de bord', 'Bon retour, Ada', 'Utilisateurs totaux']
			] as const) {
				const html = await renderAdminDashboard(project, locale);
				// The shell title exists exactly once per rendered viewport…
				expect(html).toContain(`>${shellTitle}</h1>`);
				// …and the page header states the personal context instead of
				// repeating the navigation label (#636).
				expect(html).toMatch(new RegExp(`<h2 class="h2[^"]*">${welcome}</h2>`));
				expect(html).not.toMatch(new RegExp(`<h2 class="h2[^"]*">${navLabel}</h2>`));
				// Order matters: the shell title renders first, the page title after it.
				expect(html.indexOf(`<h1`)).toBeLessThan(html.indexOf('<h2 class="h2'));
				// Real metric values stay rendered with their localized labels.
				expect(html).toContain(totalLabel);
			}
		} finally {
			rmSync(project, { recursive: true, force: true });
		}
	});

	it('presents the recent-users section with an explicit empty state (#636)', async () => {
		const project = mkdtempSync(join(process.cwd(), '.svforge-dashboard-empty-'));
		try {
			const sv = filesystemSv(project);
			seedOfficialFoundationOnDisk(project);
			applyDashboardMode(asSvApi(sv), baseFiles, dashboardFiles, 'vitest', dashboardRootFiles);

			const html = await renderAdminDashboard(project, 'en');
			// The harness passes recentUsers: [] — a real zero-record situation.
			expect(html).toContain('No users found');
		} finally {
			rmSync(project, { recursive: true, force: true });
		}
	});
});
