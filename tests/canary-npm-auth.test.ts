import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('canary npm authentication (#563)', () => {
	it('sends the configured token to a local fake npm registry without contacting npmjs', async () => {
		const root = mkdtempSync(join(tmpdir(), 'svforge-canary-registry-'));
		let authorization: string | undefined;
		const server = createServer((request, response) => {
			if (request.url !== '/-/whoami') {
				response.writeHead(404).end();
				return;
			}
			authorization = request.headers.authorization;
			if (authorization !== 'Bearer fake-canary-token') {
				response.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'unauthorized' }));
				return;
			}
			response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ username: 'snapshot-reviewer' }));
		});

		try {
			await new Promise<void>((resolve, reject) => {
				server.once('error', reject);
				server.listen(0, '127.0.0.1', resolve);
			});
			const address = server.address();
			if (!address || typeof address === 'string') throw new Error('fake registry did not bind a TCP port');
			const registry = `http://127.0.0.1:${address.port}/`;
			const userConfig = join(root, '.npmrc');
			writeFileSync(userConfig, [
				`registry=${registry}`,
				`//127.0.0.1:${address.port}/:_authToken=\${NODE_AUTH_TOKEN}`,
				''
			].join('\n'));

			const whoami = await new Promise<string>((resolve, reject) => {
				execFile('npm', ['whoami', '--registry', registry], {
					cwd: root,
					env: {
						...process.env,
						NPM_CONFIG_USERCONFIG: userConfig,
						NODE_AUTH_TOKEN: 'fake-canary-token',
						npm_config_audit: 'false',
						npm_config_update_notifier: 'false'
					}
				}, (error, stdout) => error ? reject(error) : resolve(stdout));
			});
			expect(whoami.trim()).toBe('snapshot-reviewer');
			expect(authorization).toBe('Bearer fake-canary-token');
		} finally {
			if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
			rmSync(root, { recursive: true, force: true });
		}
	});
});
