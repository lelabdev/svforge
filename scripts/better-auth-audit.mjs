#!/usr/bin/env node
/**
 * Runtime vulnerability audit of the better-auth dependency stack (#319).
 *
 * The repository audit (`scripts/audit.mjs`, #351) covers the REPO's own
 * lockfile — it can never see the better-auth version the scaffold ships,
 * because better-auth is emitted into generated projects, not installed
 * here. This script closes that gap: point it at a lockfile that resolves
 * the better-auth stack (the scaffolded dashboard's bun.lock, or a scratch
 * project created just for the check) and it fails on CRITICAL/HIGH
 * advisories affecting better-auth AND ITS FULL DEPENDENCY CLOSURE.
 *
 * SCOPE — APPROACH (fixed in the #319 review; the first version inferred the
 * scope from lockfile keys only and silently missed HOISTED transitive
 * packages like `jose`, whose key sits at the root of a bun.lock):
 *
 *   The scope is the UNION of:
 *   1. The resolved dependency closure computed from the better-auth and
 *      @better-auth/* entries: their `dependencies`, `optionalDependencies`
 *      and REQUIRED peer dependencies (`peerDependencies` minus
 *      `optionalPeers` — optional peers are consumer choices, e.g. svelte or
 *      drizzle-orm, and stay out of scope). Each dependency name resolves to
 *      the SHALLOWEST lockfile entry (bun's hoisting puts the effective copy
 *      at the root); duplicate versions at that depth are ALL included —
 *      over-approximation is safe, under-approximation is not. The walk is
 *      cycle-safe.
 *   2. Any entry whose lockfile path contains a better-auth/@better-auth
 *      segment (nested, non-hoisted trees).
 *
 * Threshold: critical and high BLOCK (exit 1). Moderate/low findings are
 * reported but do not fail the job — the policy lives in
 * docs/better-auth-upgrades.md and this audit runs in .github/workflows/ci.yml
 * (there is no dedicated Better Auth dependency bot since #460).
 *
 * Documented reachability exceptions use the SAME mechanism as the
 * repository audit: a scoped { package, version, advisory, path, reason }
 * entry in docs/audit-baseline.json (#351).
 *
 * Unknown severities FAIL CLOSED (treated as HIGH): an advisory we cannot
 * classify must block until a human classifies it.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatFindings, isBaselined, loadBaseline, queryOsv, resolvedPackages, stripJsonc } from './audit.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const SEVERITY_RANK = { CRITICAL: 4, HIGH: 3, MODERATE: 2, MEDIUM: 2, LOW: 1 };
const BLOCKING_THRESHOLD = 3;

/**
 * Normalizes an OSV vulnerability to CRITICAL | HIGH | MODERATE | LOW.
 * GHSA-sourced entries carry database_specific.severity; anything else
 * (bare CVSS vectors, missing severity) fails closed as HIGH.
 */
export function severityOf(vuln) {
	const declared = vuln?.database_specific?.severity;
	if (typeof declared === 'string') {
		const normalized = declared.toUpperCase();
		if (normalized in SEVERITY_RANK) return normalized;
		return 'HIGH';
	}
	return 'HIGH';
}

const isAuthStackSegment = (segment) => segment === 'better-auth' || segment.startsWith('@better-auth/');

/**
 * Scope filter (component 2): `better-auth`, `@better-auth/*`, and every
 * package nested under them in the lockfile's dependency paths.
 */
export function isBetterAuthScope(pkg) {
	const segments = pkg.paths.split('/');
	return segments.some(isAuthStackSegment) || isAuthStackSegment(pkg.name);
}

/** Dependency sections whose targets are ALWAYS part of a package's closure. */
const CLOSURE_SECTIONS = ['dependencies', 'optionalDependencies'];

/** Extracts the closure edges of one bun.lock packages entry (its meta object). */
function closureDeps(meta) {
	const deps = new Set();
	for (const section of CLOSURE_SECTIONS) {
		for (const name of Object.keys(meta?.[section] ?? {})) deps.add(name);
	}
	// Required peers only: optional peers are consumer choices (svelte,
	// drizzle-orm, pg, …) and must not widen the better-auth scope.
	const optionalPeers = new Set(meta?.optionalPeers ?? []);
	for (const name of Object.keys(meta?.peerDependencies ?? {})) {
		if (!optionalPeers.has(name)) deps.add(name);
	}
	return deps;
}

const depthOf = (key) => key.split('/').length;

/**
 * Computes the better-auth dependency closure from a bun.lock source:
 * the set of lockfile keys reachable from the better-auth/@better-auth/*
 * entries via dependencies, optionalDependencies and required peers.
 * Cycle-safe; over-approximates on same-depth duplicate versions by design.
 */
export function betterAuthClosurePaths(lockfile) {
	const json = JSON.parse(stripJsonc(lockfile));
	const byName = new Map();
	const seeds = [];
	for (const [key, value] of Object.entries(json.packages ?? {})) {
		const resolved = Array.isArray(value) ? value[0] : value;
		if (typeof resolved !== 'string') continue;
		const at = resolved.lastIndexOf('@');
		if (at <= 0) continue;
		const entry = {
			name: resolved.slice(0, at),
			paths: key,
			deps: closureDeps(Array.isArray(value) ? value[2] : undefined)
		};
		if (!byName.has(entry.name)) byName.set(entry.name, []);
		byName.get(entry.name).push(entry);
		if (isAuthStackSegment(entry.name)) seeds.push(entry);
	}

	// bun hoists the effective copy to the shallowest depth; same-depth
	// duplicates are all kept (over-approximation beats a missed vuln).
	const resolveByName = (name) => {
		const candidates = byName.get(name);
		if (!candidates?.length) return [];
		const minDepth = Math.min(...candidates.map((candidate) => depthOf(candidate.paths)));
		return candidates.filter((candidate) => depthOf(candidate.paths) === minDepth);
	};

	const closure = new Set();
	const queue = [...seeds];
	while (queue.length) {
		const entry = queue.pop();
		if (closure.has(entry.paths)) continue;
		closure.add(entry.paths);
		for (const dep of entry.deps) {
			for (const resolved of resolveByName(dep)) queue.push(resolved);
		}
	}
	return closure;
}

/**
 * Audits a bun.lock for critical/high advisories in the better-auth stack.
 *
 * @param {object} input
 * @param {string} [input.lockfile] lockfile contents (default: read from `lockfilePath`)
 * @param {string} [input.lockfilePath] path to a bun.lock
 * @param {Array|{path:string}} [input.baseline] baseline entries array, or a
 *   path to a baseline JSON via `baselinePath` (defaults to the repository
 *   docs/audit-baseline.json)
 * @param {string} [input.baselinePath] path to a baseline JSON file
 * @param {Function} [input.fetchImpl] injectable fetch (tests)
 * @returns {Promise<{blocking: unknown[], baselined: unknown[], findings: unknown[]}>}
 */
export async function auditBetterAuth({ lockfile, lockfilePath, baseline, baselinePath, fetchImpl } = {}) {
	const source = lockfile ?? readFileSync(lockfilePath ?? resolve(ROOT, 'bun.lock'), 'utf8');
	// Union of the resolved dependency closure and path-nested entries (#319
	// review): the path filter alone misses hoisted transitive packages.
	const closure = betterAuthClosurePaths(source);
	const packages = resolvedPackages(source).filter((pkg) => closure.has(pkg.paths) || isBetterAuthScope(pkg));
	const results = await queryOsv(packages, fetchImpl);

	const entries = formatFindings(packages, results).map((finding) => {
		const vuln = results?.results?.[findingsIndex(packages, finding)]?.vulns?.find((v) => finding.ids.includes(v.id));
		return { ...finding, severity: severityOf(vuln) };
	});

	const baselineEntries = Array.isArray(baseline) ? baseline : loadBaseline(baselinePath);
	const blocking = entries.filter(
		(finding) => SEVERITY_RANK[finding.severity] >= BLOCKING_THRESHOLD && !isBaselined(finding, baselineEntries)
	);
	const baselined = entries.filter((finding) => isBaselined(finding, baselineEntries));

	return { blocking, baselined, findings: entries };
}

/** OSV results are positionally aligned with the queried packages. */
function findingsIndex(packages, finding) {
	return packages.findIndex((pkg) => pkg.name === finding.name && pkg.version === finding.version && pkg.paths === finding.path);
}

function report({ blocking, baselined, findings }) {
	console.log(`better-auth stack audit: ${findings.length} finding(s) in scope, ${baselined.length} baselined, ${blocking.length} blocking.`);
	for (const finding of findings) {
		const mark = blocking.includes(finding) ? '✗ BLOCKING' : baselined.includes(finding) ? '◆ baselined' : '· below threshold';
		console.log(`${mark} [${finding.severity}] ${finding.package} ${finding.advisory}\n    ${finding.summary}`);
	}
	if (blocking.length) {
		console.error(
			`\n${blocking.length} blocking better-auth advisory(ies). Upgrade the pin, or add a scoped\n` +
			'{ package, version, advisory, path, reason } entry to docs/audit-baseline.json\n' +
			'with a written reachability justification.'
		);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const args = process.argv.slice(2);
	const lockArgIndex = args.findIndex((arg) => !arg.startsWith('--'));
	const baselineFlag = args.indexOf('--baseline');
	const baselinePath = baselineFlag === -1 ? undefined : args[baselineFlag + 1];
	const lockfilePath = lockArgIndex === -1 ? undefined : args[lockArgIndex];
	auditBetterAuth({ lockfilePath, baselinePath })
		.then((result) => {
			report(result);
			if (result.blocking.length) process.exitCode = 1;
		})
		.catch((error) => {
			console.error(`better-auth audit failed: ${error.message}`);
			process.exitCode = 1;
		});
}
