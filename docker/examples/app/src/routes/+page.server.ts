import { nanoid } from 'nanoid';
import { z } from 'zod';

// Injected by vite.config.ts from the installed node_modules.
declare const __ZOD_VERSION__: string;

export function load() {
	return {
		id: nanoid(),
		ok: z.string().min(1).safeParse('consumer-fixture').success,
		zodVersion: __ZOD_VERSION__
	};
}
