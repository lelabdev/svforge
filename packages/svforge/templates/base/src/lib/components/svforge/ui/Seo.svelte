<script lang="ts">
	import { page } from '$app/state';
	import { resolveAbsoluteUrl } from '#lib/utils/web.js';

	interface Props {
		title: string;
		description: string;
		image?: string;
		url?: string;
		type?: string;
	}

	let { title, description, image, url, type = 'website' }: Props = $props();

	const resolvedUrl = $derived(resolveAbsoluteUrl(url, page.url.href));
	const resolvedImage = $derived(image ? resolveAbsoluteUrl(image, page.url.href) : undefined);
	const twitterCard = $derived(resolvedImage ? 'summary_large_image' : 'summary');
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="description" content={description} />
	<link rel="canonical" href={resolvedUrl} />
	<meta property="og:title" content={title} />
	<meta property="og:description" content={description} />
	<meta property="og:type" content={type} />
	<meta property="og:url" content={resolvedUrl} />
	{#if resolvedImage}
		<meta property="og:image" content={resolvedImage} />
	{/if}
	<meta name="twitter:card" content={twitterCard} />
	<meta name="twitter:title" content={title} />
	<meta name="twitter:description" content={description} />
	{#if resolvedImage}
		<meta name="twitter:image" content={resolvedImage} />
	{/if}
</svelte:head>
