#!/usr/bin/env node
/**
 * Dependency vulnerability audit (#351, #689).
 *
 * Queries the public OSV.dev API with every resolved package version from the
 * repository's authoritative lockfiles — the root workspace lockfile and the
 * Docker builder/consumer lockfiles that CI actually installs from. Secondary
 * lockfiles were previously invisible to this gate (#689).
 *
 * Network-transient behavior: each OSV request is retried up to MAX_ATTEMPTS
 * with linear backoff. If the API remains unreachable after that, the audit
 * FAILS — an unreachable registry never silently passes real findings.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OSV_BATCH_URL = 'https://api.osv.dev/v1/querybatch';
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;
/** The public querybatch endpoint accepts at most 1000 queries per request. */
const MAX_BATCH_QUERIES = 1000;

/**
 * Every checked-in lockfile this gate must see. A missing entry is a hard
 * failure: shrinking coverage silently is how the Docker lockfiles were missed.
 */
export const AUDITED_LOCKFILES = [
	'bun.lock',
	'docker/builder.bun.lock',
	'docker/examples/app/bun.lock'
];

/** Strip JSONC line/block comments and trailing commas, respecting string literals. */
export function stripJsonc(source) {
	let out = '';
	let inString = false;
	let escaped = false;
	for (let index = 0; index < source.length; index++) {
		const char = source[index];
		const next = source[index + 1];
		if (inString) {
			out += char;
			if (escaped) escaped = false;
			else if (char === '\\') escaped = true;
			else if (char === '"') inString = false;
			continue;
		}
		if (char === '"') {
			inString = true;
			out += char;
		} else if (char === '/' && next === '/') {
			while (index < source.length && source[index] !== '\n') index++;
			out += ' ';
		} else if (char === '/' && next === '*') {
			index += 2;
			while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index++;
			index++;
			out += ' ';
		} else if (char === ',') {
			let look = index + 1;
			while (look < source.length && /\s/.test(source[look])) look++;
			// Drop commas directly before a closing brace/bracket (trailing comma).
			if (source[look] === '}' || source[look] === ']') continue;
			out += char;
		} else {
			out += char;
		}
	}
	return out;
}

/**
 * Extract every resolved { name, version, path, lockfile } from a bun.lock
 * ("packages" map). `source` labels the lockfile the version was resolved in,
 * so findings and baseline exceptions stay scoped to one dependency tree.
 */
export function resolvedPackages(lockfile = readFileSync(resolve(ROOT, 'bun.lock'), 'utf8'), source = 'bun.lock') {
	const json = JSON.parse(stripJsonc(lockfile));
	const packages = [];
	for (const [key, entry] of Object.entries(json.packages ?? {})) {
		const resolved = Array.isArray(entry) ? entry[0] : entry;
		if (typeof resolved !== 'string') continue;
		const at = resolved.lastIndexOf('@');
		if (at <= 0) continue;
		const version = resolved.slice(at + 1);
		// Skip non-registry locators (workspace links, git, file, tarball URLs):
		// OSV can only match published npm versions.
		if (/^(workspace|git|file|https?):/.test(version)) continue;
		packages.push({ name: resolved.slice(0, at), version, paths: key, lockfile: source });
	}
	return packages;
}

/** Resolve every audited lockfile. A missing lockfile fails instead of narrowing scope. */
export function collectPackages(lockfiles = AUDITED_LOCKFILES, root = ROOT) {
	return lockfiles.flatMap((lockfile) => {
		let source;
		try {
			source = readFileSync(resolve(root, lockfile), 'utf8');
		} catch (error) {
			if (error.code !== 'ENOENT') throw error;
			throw new Error(
				`Audited lockfile is missing: ${lockfile}. Dependency coverage must never shrink silently — ` +
					'restore the lockfile or update AUDITED_LOCKFILES with a reviewed justification.',
				{ cause: error }
			);
		}
		return resolvedPackages(source, lockfile);
	});
}

function sleep(ms) {
	return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

const isTransientNetworkError = (error) =>
	error?.cause?.code === 'ECONNRESET'
	|| error?.cause?.code === 'ENOTFOUND'
	|| error?.cause?.code === 'ETIMEDOUT'
	|| error?.cause?.code === 'EAI_AGAIN';

export async function queryOsv(
	packages,
	fetchImpl = fetch,
	{ retryDelayMs = RETRY_DELAY_MS, maxAttempts = MAX_ATTEMPTS, batchSize = MAX_BATCH_QUERIES } = {}
) {
	// The public querybatch endpoint rejects oversized batches, and the audited
	// lockfiles together exceed that limit (#689), so query in chunks and merge
	// the per-chunk results in the original package order.
	const merged = { results: [] };
	for (let offset = 0; offset < packages.length; offset += batchSize) {
		const batch = await queryOsvBatch(packages.slice(offset, offset + batchSize), fetchImpl, {
			retryDelayMs,
			maxAttempts
		});
		merged.results.push(...(batch.results ?? []));
	}
	return merged;
}

async function queryOsvBatch(packages, fetchImpl, { retryDelayMs, maxAttempts }) {
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			const response = await fetchImpl(OSV_BATCH_URL, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					// Official querybatch schema: `version` sits on the query item,
					// beside — not inside — the `package` object (#359 review).
					queries: packages.map((pkg) => ({
						package: { name: pkg.name, ecosystem: 'npm' },
						version: pkg.version
					}))
				}),
				signal: AbortSignal.timeout(30_000)
			});
			if (!response.ok) throw new Error(`OSV API returned HTTP ${response.status}`);
			return await response.json();
		} catch (error) {
			const transient = isTransientNetworkError(error) || error.name === 'TimeoutError' || /HTTP 5\d\d/.test(error.message);
			if (attempt === maxAttempts || !transient) {
				throw new Error(
					`OSV audit could not complete after ${attempt} attempt(s) — refusing to pass on an unverified dependency tree.\n${error.message}`,
					{ cause: error }
				);
			}
			await sleep(retryDelayMs * attempt);
		}
	}
}

export function formatFindings(packages, results) {
	const findings = [];
	for (const [index, result] of (results?.results ?? []).entries()) {
		for (const vuln of result.vulns ?? []) {
			const pkg = packages[index];
			const advisory = [vuln.id, ...(vuln.aliases ?? [])].join(', ');
			findings.push({
				name: pkg.name,
				version: pkg.version,
				path: pkg.paths,
				lockfile: pkg.lockfile,
				package: `${pkg.name}@${pkg.version}`,
				advisory,
				ids: [vuln.id, ...(vuln.aliases ?? [])],
				summary: (vuln.summary ?? 'no summary').trim()
			});
		}
	}
	return findings;
}

/**
 * Narrow, documented baseline (#359 review, #689): one exception per
 * { lockfile, package, version, path, advisory } with a written, dated
 * justification. An advisory ID alone would silently accept the same
 * vulnerability reintroduced through another package, version, lockfile or
 * dependency path.
 */
const BASELINE_PATH = resolve(ROOT, 'docs', 'audit-baseline.json');

export function loadBaseline(path = BASELINE_PATH) {
	try {
		const parsed = JSON.parse(readFileSync(path, 'utf8'));
		if (!Array.isArray(parsed)) throw new Error('baseline must be an array');
		for (const entry of parsed) {
			for (const field of ['lockfile', 'package', 'version', 'advisory', 'path', 'reason']) {
				if (typeof entry[field] !== 'string' || !entry[field].trim()) {
					throw new Error(`baseline entry needs a non-empty string ${field}: ${JSON.stringify(entry)}`);
				}
			}
			if (/^TODO\b/i.test(entry.reason.trim())) {
				throw new Error(`unjustified baseline entry (reason is a placeholder): ${JSON.stringify(entry)}`);
			}
			// Every exception carries the date it was reviewed and a mitigation
			// or follow-up, so a stale risk acceptance is visible in review.
			if (!/^\d{4}-\d{2}-\d{2}\b/.test(entry.reason.trim())) {
				throw new Error(`baseline entry reason must start with its review date (YYYY-MM-DD): ${JSON.stringify(entry)}`);
			}
		}
		return parsed;
	} catch (error) {
		if (error.code === 'ENOENT') return [];
		throw new Error(`Invalid audit baseline (${path}): ${error.message}`, { cause: error });
	}
}

export function isBaselined(finding, baseline) {
	return baseline.some(
		(entry) =>
			entry.lockfile === finding.lockfile
			&& entry.package === finding.name
			&& entry.version === finding.version
			&& entry.path === finding.path
			&& finding.ids.includes(entry.advisory)
	);
}

/**
 * Exceptions that no longer describe a resolved package. They must be removed:
 * a stale exception silently pre-approves a future finding on the same path.
 */
export function staleBaselineEntries(baseline, packages) {
	return baseline.filter(
		(entry) =>
			!packages.some(
				(pkg) =>
					pkg.lockfile === entry.lockfile
					&& pkg.name === entry.package
					&& pkg.version === entry.version
					&& pkg.paths === entry.path
			)
	);
}

/** Human-readable inventory + findings table, used by `--report` and PR review. */
export function formatReport(packages, findings, baseline) {
	const lockfiles = [...new Set(packages.map((pkg) => pkg.lockfile))];
	const rows = [
		'| Lockfile | Resolved versions | Known advisories | Baselined |',
		'| --- | --- | --- | --- |',
		...lockfiles.map((lockfile) => {
			const scoped = findings.filter((finding) => finding.lockfile === lockfile);
			const baselined = scoped.filter((finding) => isBaselined(finding, baseline)).length;
			return `| ${lockfile} | ${packages.filter((pkg) => pkg.lockfile === lockfile).length} | ${scoped.length} | ${baselined} |`;
		})
	];
	if (findings.length) {
		rows.push(
			'',
			'| Lockfile | Package | Path | Advisory | Baselined |',
			'| --- | --- | --- | --- | --- |',
			...findings.map(
				(finding) =>
					`| ${finding.lockfile} | ${finding.package} | ${finding.path} | ${finding.advisory} | ${isBaselined(finding, baseline) ? 'yes' : 'NO'} |`
			)
		);
	}
	return rows.join('\n');
}

export async function audit({ updateBaseline = false, report = false } = {}) {
	const packages = collectPackages();
	const results = await queryOsv(packages);
	const findings = formatFindings(packages, results);
	const lockfileCount = `${packages.length} resolved versions across ${AUDITED_LOCKFILES.length} lockfile(s)`;

	if (updateBaseline) {
		// REPLACE, never merge: stale exceptions must be re-justified, not
		// accumulated forever (#359 review). Placeholder reasons deliberately
		// leave the gate failing until each entry is manually justified.
		const entries = findings.map((finding) => ({
			lockfile: finding.lockfile,
			package: finding.name,
			version: finding.version,
			advisory: finding.ids[0],
			path: finding.path,
			reason: 'TODO: justify this exception before the next release.'
		}));
		writeFileSync(BASELINE_PATH, `${JSON.stringify(entries, null, '\t')}\n`);
		if (entries.length) {
			throw new Error(
				`Baseline written with ${entries.length} unjustified placeholder entrie(s).\n` +
				`The audit will keep failing until every "TODO" reason in ${BASELINE_PATH}\n` +
				'is replaced by a real, dated, reviewed justification.'
			);
		}
		console.log('Baseline replaced: 0 scoped exceptions needed.');
		return { findings, unknown: [] };
	}

	const baseline = loadBaseline();
	const unknown = findings.filter((finding) => !isBaselined(finding, baseline));
	const stale = staleBaselineEntries(baseline, packages);

	if (report) console.log(`${formatReport(packages, findings, baseline)}\n`);

	if (unknown.length) {
		throw new Error(
			`${unknown.length} NEW vulnerable package version(s) not covered by the scoped baseline:\n` +
			unknown
				.map(
					(finding) =>
						`- ${finding.package} [${finding.lockfile} → ${finding.path}]\n  ${finding.advisory}\n  ${finding.summary}`
				)
				.join('\n') +
			'\nRemediate with `bun update <package>`, or add a scoped { lockfile, package, version, path, advisory, reason }\nentry to docs/audit-baseline.json with a written, dated justification.'
		);
	}
	if (stale.length) {
		throw new Error(
			`${stale.length} obsolete baseline entrie(s) no longer match a resolved package:\n` +
			stale.map((entry) => `- ${entry.package}@${entry.version} [${entry.lockfile} → ${entry.path}] (${entry.advisory})`).join('\n') +
			'\nRemove them from docs/audit-baseline.json: an obsolete exception silently pre-approves a future finding.'
		);
	}
	console.log(`Dependency audit OK: ${lockfileCount}, ${findings.length} known advisories (scoped baseline), 0 new.`);
	return { findings, unknown };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	audit({
		updateBaseline: process.argv.includes('--update-baseline'),
		report: process.argv.includes('--report')
	}).catch((error) => {
		console.error(`Dependency audit failed: ${error.message}`);
		process.exitCode = 1;
	});
}
