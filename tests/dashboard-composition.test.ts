import { describe, expect, it } from 'vitest';
import type { SvApi } from 'sv';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyBaseMode } from '../packages/svforge/src/modes/base';
import { applyDashboardMode } from '../packages/svforge/src/modes/dashboard';
import { baseFiles, baseRootFiles, dashboardFiles, dashboardRootFiles } from '../packages/svforge/src/templates';

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
	writeFileSync(
		join(renderDir, 'messages.js'),
		Object.entries(messages)
			.filter(([key]) => key !== '$schema')
			.map(([key, value]) => `export const ${key} = () => ${JSON.stringify(value)};`)
			.join('\n')
	);
	writeFileSync(join(renderDir, 'cn.js'), 'export const cn = (...classes) => classes.filter(Boolean).join(" ");');
	writeFileSync(
		join(renderDir, 'Empty.js'),
		compileComponent('<script>let { children } = $props();</script>{@render children?.()}', 'Empty.svelte')
	);

	const layout = readFileSync(
		join(project, 'src/lib/components/svforge/layout/AdminLayout.svelte'),
		'utf8'
	)
		.replace(/^\s*import .*;\n/gm, '')
		.replace(
			'<script lang="ts">',
			`<script lang="ts">
	import * as m from './messages.js';
	import { cn } from './cn.js';
	import Empty from './Empty.js';
	const Users = Empty, Gear = Empty, ChartBar = Empty, SignOut = Empty, Menu = Empty, X = Empty, ThemeToggle = Empty;`
		);
	const page = readFileSync(join(project, 'src/routes/(app)/admin/+page.svelte'), 'utf8')
		.replace(/^\s*import .*;\n/gm, '')
		.replace(
			'<script lang="ts">',
			`<script lang="ts">
	import * as m from './messages.js';
	import Empty from './Empty.js';
	const Card = Empty, AvatarInitial = Empty, Badge = Empty, Button = Empty, Users = Empty, ChartBar = Empty, Clock = Empty;`
		);

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

	const { default: App } = await import(pathToFileURL(join(renderDir, 'App.js')).href);
	return render(App).body;
}

describe('dashboard admin composition', () => {
	it('overrides the base prerender default to keep dashboard routes dynamic', () => {
		const project = mkdtempSync(join(process.cwd(), '.svforge-dashboard-prerender-'));
		try {
			const sv = filesystemSv(project);
			applyBaseMode(asSvApi(sv), baseFiles, baseRootFiles);
			applyDashboardMode(asSvApi(sv), baseFiles, dashboardFiles, 'vitest', dashboardRootFiles);

			const routeConfig = readFileSync(join(project, 'src/routes/+layout.ts'), 'utf8');
			expect(routeConfig).toMatch(/export const prerender = false/);
		} finally {
			rmSync(project, { recursive: true, force: true });
		}
	});

	it('scaffolds and renders a shell title before a distinct localized admin page title', async () => {
		const project = mkdtempSync(join(process.cwd(), '.svforge-dashboard-composition-'));
		try {
			const sv = filesystemSv(project);
			applyBaseMode(asSvApi(sv), baseFiles, baseRootFiles);
			applyDashboardMode(asSvApi(sv), baseFiles, dashboardFiles, 'vitest', dashboardRootFiles);

			for (const [locale, shellTitle, pageTitle] of [
				['en', 'Admin', 'Dashboard'],
				['fr', 'Admin', 'Tableau de bord']
			] as const) {
				const html = await renderAdminDashboard(project, locale);
				expect(html).toMatch(new RegExp(`<h1[^>]*>${shellTitle}</h1>`));
				expect(html).toMatch(new RegExp(`<h2[^>]*>${pageTitle}</h2>`));
				expect(pageTitle).not.toBe(shellTitle);
				// #317: the page title consumes the native Skeleton h2 utility
				// (shell chrome keeps its compact local heading). Order matters:
				// the shell title renders first, the page title after it.
				expect(html.indexOf(`<h1 class="text-lg font-bold">${shellTitle}</h1>`)).toBeLessThan(
					html.indexOf(`<h2 class="h2">${pageTitle}</h2>`)
				);
			}
		} finally {
			rmSync(project, { recursive: true, force: true });
		}
	});
});
