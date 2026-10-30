import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('reads ICO magic without closing the curl pipe early under pipefail', () => {
	const harness = readFileSync(join(process.cwd(), 'scripts/test-scaffold.sh'), 'utf8');
	const probe = harness.split('\n').find((line) => line.trim().startsWith('favicon_magic=$('));
	expect(probe).toBeDefined();
	expect(probe).toContain('{ head -c 4; cat >/dev/null; }');

	const dir = mkdtempSync(join(tmpdir(), 'svforge-favicon-pipefail-'));
	try {
		// A sufficiently large favicon makes curl return 23 when piped to a
		// short-reading head command while pipefail is enabled.
		writeFileSync(join(dir, 'favicon.ico'), Buffer.concat([
			Buffer.from([0x00, 0x00, 0x01, 0x00]),
			Buffer.alloc(256 * 1024)
		]));
		const script = `set -euo pipefail
ORIGIN="file://${dir}"
${probe?.trim()}
printf '%s\\n' "$favicon_magic"`;
		expect(execFileSync('bash', ['-c', script], { encoding: 'utf8' }).trim()).toBe('00000100');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
