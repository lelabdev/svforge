<script lang="ts">
import { Card } from '$lib/components/svforge/ui';
import { Badge } from '$lib/components/svforge/primitives';
import { getLocale, localizeHref } from '$lib/paraglide/runtime';
import * as m from '$lib/paraglide/messages.js';
let { data } = $props();
</script>

<svelte:head><title>{m.blog_title()}</title></svelte:head>

<main class="max-w-7xl mx-auto px-4 py-8">
<h1 class="h1 mb-8">{m.blog_title()}</h1>
<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
{#each data.posts as post (post.slug)}
<a href={localizeHref(`/blog/${post.slug}`)}>
<Card variant="elevated" class="h-full">
<h2 class="h3 mb-2">{post.title}</h2>
<p class="text-surface-500 mb-4">{post.excerpt}</p>
<div class="flex gap-2">
{#each post.tags as tag}
<Badge variant="tonal">{tag}</Badge>
{/each}
</div>
<p class="text-sm text-surface-400 mt-4">{new Date(post.date).toLocaleDateString(getLocale(), { year: 'numeric', month: 'long', day: 'numeric' })}</p>
</Card>
</a>
{/each}
</div>
</main>
