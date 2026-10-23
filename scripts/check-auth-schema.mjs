#!/usr/bin/env node
/**
 * Better Auth runtime schema ↔ committed schema gate (#319).
 *
 * The dashboard template commits `src/lib/server/db/auth.schema.ts` and the
 * scaffold ships an `auth:schema` script that regenerates it with the
 * (version-lagging) `@better-auth/cli`. A first version of this gate diffed
 * COLUMN NAMES from that CLI output — but the CLI's bundled schema knowledge
 * lags the runtime (1.4.x vs 1.7.x), so type, nullability, default, index
 * and FK drift could pass silently (#319 review).
 *
 * FIXED APPROACH: the reference schema is derived from the INSTALLED
 * better-auth RUNTIME via `getSchema()` (`better-auth/db`), resolved from
 * the audited project's node_modules. The committed drizzle schema is
 * parsed fully and compared on:
 *
 *   column NAMES (property ↔ runtime field) AND TYPES AND NULLABILITY AND
 *   DEFAULTS AND UNIQUES AND INDEXES AND FOREIGN KEYS.
 *
 * Comparison conventions:
 *   - `id` is an implicit primary key in every better-auth model — the
 *     runtime never declares it as a field, so the normalizer injects it;
 *     the committed table must carry exactly one `.primaryKey()` column.
 *   - Runtime field keys map to drizzle COLUMN PROPERTY names (the drizzle
 *     adapter resolves fields by property); the DB column name is reported
 *     in drift messages.
 *   - Computed defaults (function/Date, e.g. `now()`) match any committed
 *     `.default(...)`; scalar defaults must match exactly.
 *   - drizzle `$onUpdate` is client-side only and NOT schema-level — the
 *     runtime `onUpdate` flag is deliberately not compared.
 *   - The template's app-level `disabled` deactivation column is not part
 *     of the Better Auth model — the caller passes it as an allowlist.
 *   - Type mapping is family-based (string→text/varchar/uuid, number→
 *     integer/…, date→timestamp/…, json→json/jsonb) so equivalent storage
 *     types pass while real drift still fails.
 *
 * Usage: check-auth-schema.mjs <committed.ts> [--project <dir>]
 *   <committed.ts>   the template's committed auth.schema.ts
 *   --project <dir>  project whose INSTALLED better-auth provides the
 *                    reference schema (default: cwd — run inside the
 *                    scaffolded project, where the gate uses it)
 * Fails (exit 1) on any drift.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/* ------------------------------------------------------------------ */
/* Runtime reference                                                   */
/* ------------------------------------------------------------------ */

/**
 * Derives the reference schema from the better-auth installed in `projectDir`
 * (resolved through its package.json, so the gate always audits the version
 * the scaffold actually ships).
 *
 * @param {string} [projectDir] defaults to the process cwd
 * @returns {Promise<Record<string, { fields: Record<string, object> }>>} normalized model
 */
export async function deriveRuntimeModel(projectDir = process.cwd()) {
	const require_ = createRequire(join(resolve(projectDir), 'package.json'));
	const dbEntry = require_.resolve('better-auth/db');
	const { getSchema } = await import(pathToFileURL(dbEntry).href);
	return normalizeRuntimeSchema(getSchema({}));
}

/**
 * Normalizes `getSchema()` output into comparable column models and injects
 * the implicit `id` primary key better-auth never declares as a field.
 *
 * @param {Record<string, { fields: Record<string, object> }>} schema getSchema() output
 */
export function normalizeRuntimeSchema(schema) {
	const model = {};
	for (const [tableName, table] of Object.entries(schema ?? {})) {
		const fields = {};
		if (!table.fields.id) {
			fields.id = {
				type: 'string',
				required: true,
				hasDefault: false,
				defaultValue: undefined,
				defaultIsComputed: false,
				unique: false,
				indexed: false,
				references: null,
				implicitPrimaryKey: true
			};
		}
		for (const [fieldName, field] of Object.entries(table.fields ?? {})) {
			const isComputed = typeof field.defaultValue === 'function' || field.defaultValue instanceof Date;
			fields[fieldName] = {
				type: field.type,
				required: field.required ?? true,
				hasDefault: field.defaultValue !== undefined,
				defaultValue: isComputed ? undefined : field.defaultValue,
				defaultIsComputed: isComputed,
				unique: Boolean(field.unique),
				indexed: Boolean(field.index),
				references: field.references
					? { model: field.references.model, field: field.references.field, onDelete: field.references.onDelete }
					: null,
				implicitPrimaryKey: false
			};
		}
		model[tableName] = { fields };
	}
	return model;
}

/* ------------------------------------------------------------------ */
/* Drizzle schema parsing                                              */
/* ------------------------------------------------------------------ */

/** Runtime DB types → acceptable drizzle pg column types (family-based). */
const TYPE_FAMILIES = {
	string: ['text', 'varchar', 'char', 'uuid'],
	number: ['integer', 'int', 'smallint', 'bigint', 'numeric', 'decimal', 'real', 'double'],
	boolean: ['boolean', 'bool'],
	date: ['timestamp', 'date', 'time'],
	json: ['json', 'jsonb']
};

/** Matches a string-ish region so nested braces/commas don't break scanning. */
function scanSkippingStrings(source, startIndex, isBreak) {
	let inString = null;
	let escaped = false;
	for (let index = startIndex; index < source.length; index++) {
		const char = source[index];
		if (inString) {
			if (escaped) escaped = false;
			else if (char === '\\') escaped = true;
			else if (char === inString) inString = null;
			continue;
		}
		if (char === '"' || char === "'" || char === '`') {
			inString = char;
			continue;
		}
		if (isBreak(char, index)) return index;
	}
	return source.length;
}

/** Index of the `}` closing the object opened at `openIndex`. */
function matchBrace(source, openIndex) {
	let depth = 0;
	return scanSkippingStrings(source, openIndex, (char) => {
		if (char === '{') depth++;
		else if (char === '}') {
			depth--;
			if (depth === 0) return true;
		}
		return false;
	});
}

/** Splits a pgTable body on top-level commas. */
function splitTopLevel(body) {
	const chunks = [];
	let depth = 0;
	let start = 0;
	for (let index = 0; index < body.length; index++) {
		const isBreak = (char) => {
			if ('([{'.includes(char)) depth++;
			else if (')]}'.includes(char)) depth--;
			else if (char === ',' && depth === 0) return true;
			return false;
		};
		// Re-use the string-aware scanner char by char: find the next top-level
		// comma or the end, tracking depth only outside strings.
		const nextBreak = scanSkippingStrings(body, index, (char) => isBreak(char));
		if (nextBreak >= body.length) {
			chunks.push(body.slice(start));
			break;
		}
		const char = body[nextBreak];
		if (char === ',' && depth === 0) {
			chunks.push(body.slice(start, nextBreak));
			start = nextBreak + 1;
			index = nextBreak;
		} else {
			index = nextBreak;
		}
	}
	return chunks.filter((chunk) => chunk.trim());
}

/**
 * Parses one column chunk: `camelName: type('db_name')…chain`.
 *
 * @returns {object|null} column descriptor or null for non-column chunks
 */
function parseColumnChunk(chunk) {
	// Strip line comments (e.g. the documented `disabled` column comment in the
	// template) so the header regex still matches the actual declaration.
	const code = chunk.replace(/^\s*\/\/.*$/gm, '');
	const header = code.match(/^\s*([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)\s*\(\s*['"]([^'"]+)['"]/);
	if (!header) return null;
	// The official `auth:schema` script emits double-quoted strings; older
	// hand-written schemas used single quotes. Accept both.
	const referenceMatch = code.match(/\.references\(\s*\(\s*\)\s*=>\s*([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*(?:,\s*\{\s*onDelete:\s*['"](\w+)['"]\s*\})?/);
	const defaultMatch = code.match(/\.default\(\s*([^)]*?)\s*\)/);
	// The official `auth:schema` output uses `.defaultNow()` for timestamps;
	// hand-written schemas used `.default(sql\`now()\`)`. Both are computed.
	const defaultNow = /\.defaultNow\(\)/.test(code);
	return {
		property: header[1],
		drizzleType: header[2],
		column: header[3],
		notNull: /\.notNull\(\)/.test(code),
		primaryKey: /\.primaryKey\(\)/.test(code),
		unique: /\.unique\(\)/.test(code),
		hasDefault: Boolean(defaultMatch || defaultNow),
		// 'computed' covers sql`…`, new Date(), function calls — anything
		// without a comparable scalar literal.
		defaultLiteral: defaultMatch ? normalizeDefaultLiteral(defaultMatch[1]) : defaultNow ? 'computed' : null,
		references: referenceMatch
			? { table: referenceMatch[1], property: referenceMatch[2], onDelete: referenceMatch[3] ?? null }
			: null,
		hasOnUpdate: /\$onUpdate\(/.test(code)
	};
}

/** Reduces a `.default(…)` argument to a scalar literal or 'computed'. */
function normalizeDefaultLiteral(literal) {
	const trimmed = literal.trim();
	if (/^(true|false)$/.test(trimmed)) return trimmed;
	if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
	if (/^'[^']*'$/.test(trimmed) || /^"[^"]*"$/.test(trimmed)) return trimmed.replace(/^['"]|['"]$/g, '');
	return 'computed';
}

/**
 * Parses a drizzle pg schema source into comparable table models.
 * Relations (`pgTable`-less exports) are skipped; only `pgTable` counts.
 *
 * @param {string} source drizzle schema source (single- or double-quoted)
 * @returns {Record<string, { columns: Record<string, object>, indexes: string[][] }>}
 */
export function parseDrizzleTables(source) {
	const tables = {};
	const tablePattern = /pgTable\(\s*['"]([^'"]+)['"]\s*,\s*\{/g;
	for (const match of source.matchAll(tablePattern)) {
		const tableName = match[1];
		const openBrace = match.index + match[0].length - 1;
		const closeBrace = matchBrace(source, openBrace);
		const columns = {};
		for (const chunk of splitTopLevel(source.slice(openBrace + 1, closeBrace))) {
			const column = parseColumnChunk(chunk);
			if (column) columns[column.property] = column;
		}
		// Third pgTable argument: table-level indexes, e.g.
		// (table) => [index('session_userId_idx').on(table.userId)]
		const indexes = [];
		let depth = 0;
		const tailStart = closeBrace + 1;
		const tailEnd = scanSkippingStrings(source, tailStart, (char) => {
			if (char === '(') depth++;
			else if (char === ')') {
				if (depth === 0) return true;
				depth--;
			}
			return false;
		});
		const tail = source.slice(tailStart, tailEnd);
		for (const indexMatch of tail.matchAll(/index\(\s*['"][^'"]*['"]\s*\)\s*\.on\(([^)]*)\)/g)) {
			const members = indexMatch[1]
				.split(',')
				.map((member) => member.trim().match(/\.([A-Za-z_$][\w$]*)\s*$/)?.[1])
				.filter(Boolean);
			indexes.push(members);
		}
		tables[tableName] = { columns, indexes };
	}
	return tables;
}

/* ------------------------------------------------------------------ */
/* Comparison                                                          */
/* ------------------------------------------------------------------ */

function sameDefault(runtimeField, committedColumn) {
	if (!runtimeField.defaultIsComputed) {
		if (committedColumn.defaultLiteral === 'computed') return false;
		return String(runtimeField.defaultValue) === String(committedColumn.defaultLiteral);
	}
	// Computed runtime defaults (now(), Date factories) match any default.
	return committedColumn.defaultLiteral !== null;
}

/**
 * Compares the runtime-derived model against the committed drizzle schema.
 *
 * @param {Record<string, { fields: Record<string, object> }>} runtimeModel normalized getSchema() output
 * @param {string} committedSource the template's committed schema source
 * @param {Record<string, string[]>} [allowColumns] documented app-level columns
 *   per table (DB column names, e.g. { user: ['disabled'] }) that the
 *   runtime does not know.
 * @returns {{drift: Array<{kind: string, table: string, column: string|null, message: string}>}}
 */
export function compareSchemas(runtimeModel, committedSource, allowColumns = {}) {
	const committed = parseDrizzleTables(committedSource);
	const drift = [];
	const push = (kind, table, column, message) => drift.push({ kind, table, column, message });

	for (const [tableName, table] of Object.entries(runtimeModel)) {
		const committedTable = committed[tableName];
		if (!committedTable) {
			push('table', tableName, null, `runtime table '${tableName}' has no committed pgTable`);
			continue;
		}
		const unmatched = new Set(Object.keys(committedTable.columns));
		const committedIndexMembers = new Set(committedTable.indexes.flat());

		for (const [fieldName, field] of Object.entries(table.fields)) {
			const column = committedTable.columns[fieldName];
			if (!column) {
				push('column', tableName, fieldName, `runtime field '${fieldName}' (type ${field.type}) is missing from the committed schema`);
				continue;
			}
			unmatched.delete(fieldName);

			const family = TYPE_FAMILIES[field.type];
			if (family && !family.includes(column.drizzleType)) {
				push('type', tableName, fieldName, `type drift: runtime '${field.type}' vs committed '${column.drizzleType}' (db column '${column.column}')`);
			}

			const effectivelyNotNull = column.notNull || column.primaryKey;
			if (field.required && !effectivelyNotNull) {
				push('nullability', tableName, fieldName, `runtime requires NOT NULL on '${column.column}' — committed column is nullable`);
			} else if (!field.required && column.notNull) {
				push('nullability', tableName, fieldName, `runtime allows NULL on '${column.column}' — committed column is NOT NULL`);
			}

			if (field.hasDefault && !column.hasDefault) {
				push('default', tableName, fieldName, `runtime defaults '${column.column}' — committed column has no .default()`);
			} else if (!field.hasDefault && column.hasDefault) {
				push('default', tableName, fieldName, `committed '${column.column}' has a .default() the runtime does not declare`);
			} else if (field.hasDefault && column.hasDefault && !sameDefault(field, column)) {
				push('default', tableName, fieldName, `default drift on '${column.column}': runtime ${JSON.stringify(field.defaultValue)} vs committed '${column.defaultLiteral}'`);
			}

			if (field.unique && !(column.unique || column.primaryKey)) {
				push('unique', tableName, fieldName, `runtime marks '${column.column}' UNIQUE — committed column is not`);
			} else if (!field.unique && column.unique && !column.primaryKey) {
				push('unique', tableName, fieldName, `committed '${column.column}' is UNIQUE but the runtime does not declare it`);
			}

			const hasIndexEvidence = committedIndexMembers.has(fieldName) || column.unique || column.primaryKey;
			if (field.indexed && !hasIndexEvidence) {
				push('index', tableName, fieldName, `runtime requires an index on '${column.column}' — committed schema has none`);
			} else if (!field.indexed && committedIndexMembers.has(fieldName) && !column.unique && !column.primaryKey) {
				push('index', tableName, fieldName, `committed schema indexes '${column.column}' but the runtime does not`);
			}

			if (field.references && !column.references) {
				push('references', tableName, fieldName, `runtime requires a FK on '${column.column}' → ${field.references.model}.${field.references.field} — committed column has none`);
			} else if (!field.references && column.references) {
				push('references', tableName, fieldName, `committed '${column.column}' has a FK the runtime does not declare`);
			} else if (field.references && column.references) {
				if (column.references.table !== field.references.model || column.references.property !== field.references.field) {
					push('references', tableName, fieldName, `FK target drift on '${column.column}': runtime → ${field.references.model}.${field.references.field}, committed → ${column.references.table}.${column.references.property}`);
				} else if (field.references.onDelete && column.references.onDelete !== field.references.onDelete) {
					push('references', tableName, fieldName, `FK onDelete drift on '${column.column}': runtime '${field.references.onDelete}' vs committed '${column.references.onDelete ?? 'none'}'`);
				}
			}
		}

		const allowed = new Set(allowColumns[tableName] ?? []);
		for (const property of unmatched) {
			const column = committedTable.columns[property];
			if (allowed.has(column.column) || allowed.has(property)) continue;
			push('column', tableName, column.column, `committed column '${column.column}' is not known to the runtime schema (stale or undocumented app column)`);
		}
	}

	for (const tableName of Object.keys(committed)) {
		if (!runtimeModel[tableName]) {
			push('table', tableName, null, `committed table '${tableName}' is not managed by the better-auth runtime schema`);
		}
	}

	return { drift };
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

function fail(message) {
	console.error(message);
	process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const args = process.argv.slice(2);
	const positional = [];
	const projectFlagIndex = args.indexOf('--project');
	const projectDir = projectFlagIndex === -1 ? process.cwd() : args[projectFlagIndex + 1];
	for (let index = 0; index < args.length; index++) {
		if (args[index] === '--project') index++;
		else positional.push(args[index]);
	}
	const [committedPath] = positional;
	if (!committedPath) {
		fail('Usage: check-auth-schema.mjs <committed.ts> [--project <dir>]');
	} else {
		const committedSource = readFileSync(committedPath, 'utf8');
		deriveRuntimeModel(projectDir)
			.then((runtimeModel) => {
				const allowColumns = { user: ['disabled', 'role'] }; // template's app-level columns (#337 deactivation, #318 explicit admin role)
				const { drift } = compareSchemas(runtimeModel, committedSource, allowColumns);
				if (drift.length) {
					const lines = [`❌ committed auth.schema.ts does not match the installed better-auth runtime schema (#319):`];
					for (const entry of drift) {
						lines.push(`  [${entry.kind}] ${entry.table}${entry.column ? `.${entry.column}` : ''}: ${entry.message}`);
					}
					lines.push('Update the committed schema (regenerate via `bun run auth:schema`, review the diff),');
					lines.push('or extend the derivation/allowlist if the drift is an intentional app-level column.');
					fail(lines.join('\n'));
				} else {
					const tableCount = Object.keys(runtimeModel).length;
					console.log(`✅ committed auth.schema.ts matches the installed better-auth runtime schema (#319): ${tableCount} tables compared, names/types/nullability/defaults/uniques/indexes/FKs in sync.`);
				}
			})
			.catch((error) => {
				fail(`schema gate failed to derive the runtime reference (is better-auth installed in '${projectDir}'?): ${error.message}`);
			});
	}
}
