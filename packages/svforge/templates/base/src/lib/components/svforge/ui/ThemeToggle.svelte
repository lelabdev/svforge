<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import { Sun, Moon } from '$lib/icons';
	import { Button } from '$lib/components/svforge/primitives';
	import { onMount } from 'svelte';
	import { followSystemTheme } from '$lib/utils/theme';

	interface Props {
		class?: string;
	}

	let { class: className = '' }: Props = $props();
	let isDark = $state(true);
	let stopFollowingSystemTheme: (() => void) | undefined;

	function applyMode(dark: boolean) {
		const mode = dark ? 'dark' : 'light';
		document.documentElement.setAttribute('data-mode', mode);
		document.documentElement.style.colorScheme = mode;
	}

	onMount(() => {
		const stored = localStorage.getItem('theme-mode');
		const media = window.matchMedia('(prefers-color-scheme: dark)');
		const followsSystem = stored !== 'dark' && stored !== 'light';
		isDark = stored === 'dark' || (followsSystem && media.matches);
		applyMode(isDark);

		stopFollowingSystemTheme = followSystemTheme(stored, media, (dark) => {
			isDark = dark;
			applyMode(isDark);
		});

		return () => stopFollowingSystemTheme?.();
	});

	function toggle() {
		stopFollowingSystemTheme?.();
		stopFollowingSystemTheme = undefined;
		isDark = !isDark;
		applyMode(isDark);
		localStorage.setItem('theme-mode', isDark ? 'dark' : 'light');
	}
</script>

<Button
	type="button"
	variant="ghost"
	color="surface"
	onclick={toggle}
	class="size-11 p-0 {className}"
	aria-label={m.common_toggle_theme()}
>
	{#if isDark}
		<Moon size={18} />
	{:else}
		<Sun size={18} />
	{/if}
</Button>
