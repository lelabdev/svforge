import { nanoid } from 'nanoid';
import { z } from 'zod';

export function load() {
	return {
		id: nanoid(),
		ok: z.string().min(1).safeParse('consumer-fixture').success
	};
}
