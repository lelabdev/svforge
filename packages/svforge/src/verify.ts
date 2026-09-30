import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { doctor, type DiagnosticResult } from './doctor';
import { checkDesignSystem } from './design-system';
import { detectPackageManager, type SpawnPort } from './cli/add';

/**
 * `svforge verify` (#470) — one simple answer to "is this SVForge project
 * actually ready?".
 *
 * It runs the SAME validation an agent or a human would run by hand, in order:
 *
 *   doctor (svforge)  → design-system check → project `check`
 *   → production `build` → `test`
 *
 * Scope is deliberately the LIGHT path: no database, no boot, no external
 * credentials. The heavier end-to-end journey (PostgreSQL schema, dev server,
 * auth flow) lives in `scripts/test-user-journey.sh` (#462) and the release
 * golden path (#470). `verify` must never duplicate CI — it gives the same
 * quick confidence right after `svforge create`.
 *
 * Blocking ERRORS only: a fresh dashboard legitimately carries configuration
 * WARNINGS (S3 credentials to fill, missing BETTER_AUTH_SECRET before setup).
 */

export type VerifyStepName = 'doctor' | 'check' | 'project-check' | 'build' | 'test';

export interface VerifyStepResult {
	name: VerifyStepName;
	/** `skipped` is used for an optional script that is not declared. */
	status: 'ok' | 'error' | 'skipped';
	message?: string;
}

export interface VerifyOptions {
	/** Package manager override (default: detected from the lockfile). */
	pm?: string;
	/** Spawn port (test seam; the CLI always supplies the real one). */
	spawn?: SpawnPort;
}

export interface VerifyResult {
	ok: boolean;
	steps: VerifyStepResult[];
}

/** Project scripts `verify` runs, and whether their absence is fatal. */
const PROJECT_STEPS: { name: VerifyStepName; script: string; optional: boolean }[] = [
	{ name: 'project-check', script: 'check', optional: false },
	{ name: 'build', script: 'build', optional: false },
	{ name: 'test', script: 'test', optional: true }
];

function errorsOf(results: DiagnosticResult[]): DiagnosticResult[] {
	return results.filter((result) => result.status === 'error');
}

function readScripts(root: string): Record<string, string> {
	try {
		const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
			scripts?: Record<string, string>;
		};
		return manifest.scripts ?? {};
	} catch {
		return {};
	}
}

export async function runVerify(projectRoot: string, options: VerifyOptions = {}): Promise<VerifyResult> {
	const steps: VerifyStepResult[] = [];

	// ── 1. SVForge doctor (blocking ERRORS only) ──
	const report = await doctor(projectRoot);
	const doctorErrors = errorsOf(report.results);
	steps.push({
		name: 'doctor',
		status: doctorErrors.length === 0 ? 'ok' : 'error',
		message:
			doctorErrors.length === 0
				? `${report.results.length} check(s), no blocking error`
				: `${doctorErrors.length} blocking error(s): ${doctorErrors.map((r) => r.message).join(' | ')}`
	});

	// ── 2. Design-system check (blocking ERRORS only) ──
	const design = await checkDesignSystem(projectRoot);
	const designErrors = errorsOf(design);
	steps.push({
		name: 'check',
		status: designErrors.length === 0 ? 'ok' : 'error',
		message:
			designErrors.length === 0
				? `${design.length} check(s), no blocking error`
				: `${designErrors.length} violation(s): ${designErrors.map((r) => r.message).join(' | ')}`
	});

	// ── 3. Project scripts ──
	const pm = options.pm ?? detectPackageManager(projectRoot);
	const scripts = readScripts(projectRoot);
	const spawn = options.spawn;
	for (const step of PROJECT_STEPS) {
		if (!scripts[step.script]) {
			steps.push({
				name: step.name,
				status: step.optional ? 'skipped' : 'error',
				message: `No "${step.script}" script in package.json`
			});
			continue;
		}
		if (!spawn) {
			// Plan-only mode (test seam): report the declared step without running it.
			steps.push({ name: step.name, status: 'ok', message: `${pm} run ${step.script}` });
			continue;
		}
		const code = await spawn(pm, ['run', step.script], { cwd: projectRoot, stdio: 'inherit' });
		steps.push({
			name: step.name,
			status: code === 0 ? 'ok' : 'error',
			message: code === 0 ? undefined : `${pm} run ${step.script} exited with ${code}`
		});
	}

	return { ok: steps.every((step) => step.status !== 'error'), steps };
}

const STEP_LABELS: Record<VerifyStepName, string> = {
	doctor: 'SVForge doctor',
	check: 'SVForge check (design system)',
	'project-check': 'Project check (svelte-check)',
	build: 'Production build',
	test: 'Tests'
};

export function printVerifyResult(result: VerifyResult): void {
	console.log('\n SVForge verify\n');
	for (const step of result.steps) {
		const icon = step.status === 'ok' ? '✓' : step.status === 'skipped' ? '•' : '✗';
		const label = STEP_LABELS[step.name].padEnd(32);
		console.log(`  ${icon} ${label}${step.message ? ` ${step.message}` : ''}`);
	}
	console.log(result.ok ? '\n✓ Project is ready.\n' : '\n✗ Project is NOT ready — fix the errors above.\n');
}
