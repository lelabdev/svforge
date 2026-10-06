import { describe, expect, it } from 'vitest';
import { formatPostDate } from '../packages/blog/templates/src/lib/utils/post-date';

describe('blog calendar-date formatting (#478)', () => {
	it('keeps a date-only frontmatter value on the same calendar day in a negative UTC offset', () => {
		const originalTimezone = process.env.TZ;
		process.env.TZ = 'America/Los_Angeles';

		try {
			expect(new Date('2025-01-01').getTimezoneOffset()).toBe(480);
			expect(formatPostDate('2025-01-01', 'fr')).toBe('1 janvier 2025');
			expect(formatPostDate('2025-01-01', 'en')).toBe('January 1, 2025');
		} finally {
			if (originalTimezone === undefined) delete process.env.TZ;
			else process.env.TZ = originalTimezone;
		}
	});
});
