/**
 * Format a blog frontmatter date as a calendar date, not a timezone-dependent
 * instant. The explicit UTC zone keeps date-only values stable across server
 * and browser timezones during SSR and hydration.
 */
export function formatPostDate(date: string, locale: string): string {
	return new Intl.DateTimeFormat(locale, {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		timeZone: 'UTC'
	}).format(new Date(date));
}
