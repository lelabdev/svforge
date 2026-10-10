<script lang="ts">
import { getLocale, localizeHref } from '$lib/paraglide/runtime';
import { formatPostDate } from '$lib/utils/post-date';
import * as m from '$lib/paraglide/messages.js';

let { data } = $props();
// Svelte 5: components are dynamic by default — a capitalized variable holds
// the MDsveX component and is rendered directly (`<Post />`). The transport
// hook in src/hooks.ts carries the component across the data boundary (slug
// on the wire, re-imported client-side).
const Post = $derived(data.post.content.component);
const date = $derived(formatPostDate(data.post.date, getLocale()));
</script>

<svelte:head>
<title>{data.post.title}</title>
<meta name="description" content={data.post.excerpt} />
</svelte:head>

<article class="max-w-prose mx-auto px-4 py-8">
<a href={localizeHref('/blog')} class="anchor mb-4 inline-block">← {m.blog_back_to_blog()}</a>
<h1 class="h1 mb-4">{data.post.title}</h1>
<p class="text-surface-700-300 mb-8">{date}</p>
<Post />
</article>
