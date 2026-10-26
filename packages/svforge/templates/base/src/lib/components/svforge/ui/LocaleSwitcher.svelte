<script lang="ts">
	import { cn } from '#lib/utils/cn.js';
	import * as m from '#lib/paraglide/messages.js';
	import { page } from '$app/state';
	import { browser } from '$app/env';
	import {
		deLocalizeUrl,
		getLocale,
		locales,
		localizeHref,
		type Locale
	} from '#lib/paraglide/runtime.js';

	/**
	 * Reusable Paraglide language switcher (#588).
	 *
	 * The option list IS the project's configured `locales` (from
	 * `project.inlang/settings.json`, exposed by Paraglide's runtime): adding a
	 * third language must not require editing this component. A single-locale
	 * project renders nothing instead of an empty control.
	 *
	 * The options are plain anchors, not a JS menu, for two reasons:
	 * - they stay in the server-rendered HTML, so the prerender crawler still
	 *   discovers every localized route (`+layout.ts` sets `prerender = true`);
	 * - they work without JavaScript and are natively keyboard focusable.
	 * `data-sveltekit-reload` forces a document reload so the new locale's copy
	 * and `<html lang>` are the ones Paraglide renders, instead of a stale
	 * client-side hydration.
	 *
	 * Switching keeps the current route, query string and fragment: the href is
	 * de-localized first, then re-localized for the target locale.
	 *
	 * Placement is an ordinary layout choice: render it in a navbar, a footer or
	 * a page header. Do not build a second locale switcher in a project.
	 */
	interface Props {
		/** Extra classes for the wrapper (placement/spacing). */
		class?: string;
	}

	let { class: className }: Props = $props();

	// Deduplicated so a misconfigured settings file cannot render the same
	// locale twice; order follows the configuration.
	const options = $derived([...new Set(locales)]);
	const current = $derived(getLocale());

	// SvelteKit throws on `url.search`/`url.hash` while prerendering, and a
	// prerendered document has neither: the suffix is read on the client, where
	// the real query string and fragment exist.
	const suffix = $derived(browser ? `${page.url.search}${page.url.hash}` : '');

	function hrefFor(locale: Locale): string {
		const canonical = deLocalizeUrl(page.url).pathname;
		return `${localizeHref(canonical, { locale })}${suffix}`;
	}

	// Localized, human-readable name for assistive tech and the tooltip; the
	// visible tag stays a compact, recognizable "EN"/"FR"/"DE".
	const languageNames = $derived.by(() => {
		try {
			return new Intl.DisplayNames([current], { type: 'language' });
		} catch {
			return undefined;
		}
	});

	function labelFor(locale: Locale): string {
		return languageNames?.of(locale) ?? locale.toUpperCase();
	}
</script>

{#if options.length > 1}
	<div class={cn('flex items-center gap-1', className)} role="group" aria-label={m.common_language()}>
		{#each options as locale (locale)}
			{@const active = locale === current}
			<a
				href={hrefFor(locale)}
				data-sveltekit-reload
				hreflang={locale}
				aria-current={active ? 'true' : undefined}
				aria-label={labelFor(locale)}
				title={labelFor(locale)}
				class={cn(
					'btn btn-sm min-h-11 min-w-11 justify-center px-3 cursor-pointer',
					active ? 'preset-filled-primary-500' : 'preset-tonal-surface hover:preset-tonal-primary'
				)}
			>
				{locale.toUpperCase()}
			</a>
		{/each}
	</div>
{/if}
