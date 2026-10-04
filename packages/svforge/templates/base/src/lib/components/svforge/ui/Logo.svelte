<script lang="ts">
	import { cn } from '$lib/utils/cn';

	interface Props {
		class?: string;
	}

	let { class: className = '' }: Props = $props();
</script>

<span data-logo class={cn('text-xl font-extrabold', className)}>SVForge</span>

<style>
	@keyframes metalFlow {
		0% {
			background-position: 0% 50%;
		}
		50% {
			background-position: 100% 50%;
		}
		100% {
			background-position: 0% 50%;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		[data-logo] {
			animation: none;
		}
	}

	[data-logo] {
		/* #317: the brand font comes from the theme (--typo-heading--font-family
		   = Space Grotesk), not a second hard-coded copy of the family. */
		font-family: var(--typo-heading--font-family, 'Space Grotesk Variable', sans-serif);
		color: transparent;
		background: linear-gradient(
			45deg,
			var(--color-secondary-200-800),
			var(--color-secondary-500),
			var(--color-secondary-600-400),
			var(--color-secondary-200-800)
		);
		background-size: 200% 200%;
		-webkit-background-clip: text;
		background-clip: text;
		letter-spacing: 0.05em;
		animation: metalFlow 5s ease-in-out infinite;
		filter: drop-shadow(0 0 2px var(--color-secondary-200-800));
	}
</style>
