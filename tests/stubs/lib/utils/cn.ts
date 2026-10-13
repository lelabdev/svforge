// Stub for `#lib/utils/cn.js` used by template components compiled in repo-root
// tests (see vitest.config.ts alias). Values are not asserted — a plain join
// mirrors the clsx + tailwind-merge behaviour closely enough for the DOM
// assertions these tests make.
export function cn(...inputs: Array<string | false | null | undefined>): string {
	return inputs.filter(Boolean).join(' ');
}
