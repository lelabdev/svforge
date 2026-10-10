<script lang="ts">
	import { Alert, Card, Table, ThemeToggle } from '$lib/components/svforge/ui';
	import { Badge, Button, Checkbox, Input, Select, Textarea, Toggle } from '$lib/components/svforge/primitives';
	import * as m from '$lib/paraglide/messages.js';

	// Literal example shown in a <code> block — a string constant so Svelte
	// never parses the braces as an expression (#271).
	const skeletonImportExample =
		"import { Accordion, Tabs, Avatar } from '@skeletonlabs/skeleton-svelte';";

	let loading = $state(false);

	function simulateLoading() {
		loading = true;
		setTimeout(() => (loading = false), 2000);
	}
</script>

<svelte:head>
	<title>SvelteForge — {m.demo_title()}</title>
</svelte:head>

<main class="mx-auto max-w-7xl space-y-8 px-4 py-8">
	<h1 class="h1">{m.demo_title()}</h1>
	<p class="text-surface-500">{m.demo_subtitle()}</p>

	<!-- Buttons -->
	<section class="space-y-4">
		<h2 class="h2 border-b border-surface-200-800 pb-2">{m.demo_buttons()}</h2>
		<h3 class="h3">{m.demo_colors_filled()}</h3>
		<div class="flex flex-wrap gap-3">
			<Button>{m.demo_primary()}</Button>
			<Button color="secondary">{m.demo_secondary()}</Button>
			<Button color="tertiary">{m.demo_tertiary()}</Button>
			<Button color="success">{m.demo_success()}</Button>
			<Button color="warning">{m.demo_warning()}</Button>
			<Button color="error">{m.demo_error()}</Button>
			<Button color="surface">{m.demo_surface()}</Button>
		</div>
		<h3 class="h3">{m.demo_variants()}</h3>
		<div class="flex flex-wrap gap-3">
			<Button variant="filled">{m.demo_filled()}</Button>
			<Button variant="outlined">{m.demo_outlined()}</Button>
			<Button variant="tonal">{m.demo_tonal()}</Button>
			<Button variant="ghost">{m.demo_ghost()}</Button>
		</div>
		<h3 class="h3">{m.demo_sizes()}</h3>
		<div class="flex flex-wrap items-center gap-3">
			<Button size="sm">{m.demo_small()}</Button>
			<Button size="md">{m.demo_medium()}</Button>
			<Button size="lg">{m.demo_large()}</Button>
		</div>
		<h3 class="h3">{m.demo_states()}</h3>
		<div class="flex flex-wrap gap-3">
			<Button loading={loading} onclick={simulateLoading}>
				{loading ? m.common_loading() : m.demo_click_to_load()}
			</Button>
			<Button href="/">{m.demo_link_btn()}</Button>
			<Button disabled>{m.demo_disabled()}</Button>
		</div>
		<h3 class="h3">{m.demo_brand()}</h3>
		<!-- #315: the Skeleton brand concept — these presets resolve through
		     --color-brand-* in the theme; keeps the brand contract visible. -->
		<div class="flex flex-wrap gap-3">
			<button type="button" class="btn preset-filled-brand">{m.demo_filled()}</button>
			<button type="button" class="btn preset-tonal-brand">{m.demo_tonal()}</button>
			<button type="button" class="btn preset-outlined-brand">{m.demo_outlined()}</button>
		</div>
	</section>

	<!-- Cards -->
	<section class="space-y-4">
		<h2 class="h2 border-b border-surface-200-800 pb-2">{m.demo_card()}</h2>
		<div class="grid grid-cols-1 gap-6 md:grid-cols-3">
			<Card>
				<p>{m.demo_flat_card()}</p>
			</Card>
			<Card variant="elevated">
				<p>{m.demo_elevated_card()}</p>
			</Card>
			<Card variant="outlined">
				<p>{m.demo_outlined_card()}</p>
			</Card>
		</div>
		<Card>
			{#snippet header()}
				<h3 class="h3">{m.demo_card_header_footer()}</h3>
			{/snippet}
			<p>{m.demo_content_here()}</p>
			{#snippet footer()}
				<div class="flex justify-end gap-2">
					<Button variant="ghost" size="sm">{m.common_cancel()}</Button>
					<Button size="sm">{m.common_save()}</Button>
				</div>
			{/snippet}
		</Card>
	</section>

	<!-- Badges -->
	<section class="space-y-4">
		<h2 class="h2 border-b border-surface-200-800 pb-2">{m.demo_badge()}</h2>
		<h3 class="h3">{m.demo_filled()}</h3>
		<div class="flex flex-wrap gap-2">
			<Badge>{m.demo_primary()}</Badge>
			<Badge color="secondary">{m.demo_secondary()}</Badge>
			<Badge color="tertiary">{m.demo_tertiary()}</Badge>
			<Badge color="success">{m.demo_success()}</Badge>
			<Badge color="warning">{m.demo_warning()}</Badge>
			<Badge color="error">{m.demo_error()}</Badge>
			<Badge color="surface">{m.demo_surface()}</Badge>
		</div>
		<h3 class="h3">{m.demo_outlined()}</h3>
		<div class="flex flex-wrap gap-2">
			<Badge variant="outlined">{m.demo_primary()}</Badge>
			<Badge variant="outlined" color="secondary">{m.demo_secondary()}</Badge>
			<Badge variant="outlined" color="success">{m.demo_success()}</Badge>
			<Badge variant="outlined" color="warning">{m.demo_warning()}</Badge>
			<Badge variant="outlined" color="error">{m.demo_error()}</Badge>
			<Badge variant="outlined" color="surface">{m.demo_surface()}</Badge>
		</div>
		<h3 class="h3">{m.demo_tonal()}</h3>
		<div class="flex flex-wrap gap-2">
			<Badge variant="tonal">{m.demo_primary()}</Badge>
			<Badge variant="tonal" color="secondary">{m.demo_secondary()}</Badge>
			<Badge variant="tonal" color="success">{m.demo_success()}</Badge>
			<Badge variant="tonal" color="error">{m.demo_error()}</Badge>
		</div>
	</section>

	<!-- Alerts -->
	<section class="space-y-4">
		<h2 class="h2 border-b border-surface-200-800 pb-2">{m.demo_alert()}</h2>
		<div class="space-y-3">
			<Alert variant="info">{m.demo_alert_info()}</Alert>
			<Alert variant="success">{m.demo_alert_success()}</Alert>
			<Alert variant="warning">{m.demo_alert_warning()}</Alert>
			<Alert variant="error">{m.demo_alert_error()}</Alert>
		</div>
	</section>

	<!-- Typography (#317): the NATIVE Skeleton typography utilities — h1…h6,
	     anchor, pre, kbd — consume the --typo-* / --font-mono theme tokens, so
	     this section visibly validates every typography theme change. -->
	<section class="space-y-4">
		<h2 class="h2 border-b border-surface-200-800 pb-2">{m.demo_typography()}</h2>
		<p class="text-surface-500">{m.demo_typography_desc()}</p>
		<div class="space-y-2">
			<h1 class="h1">{m.demo_heading_level({ level: 1 })}</h1>
			<h2 class="h2">{m.demo_heading_level({ level: 2 })}</h2>
			<h3 class="h3">{m.demo_heading_level({ level: 3 })}</h3>
			<h4 class="h4">{m.demo_heading_level({ level: 4 })}</h4>
			<h5 class="h5">{m.demo_heading_level({ level: 5 })}</h5>
			<h6 class="h6">{m.demo_heading_level({ level: 6 })}</h6>
		</div>
		<p>
			{m.demo_typography_anchor()}
			<a class="anchor" href="https://github.com/lelabdev/svelteforge">{m.demo_github()}</a>
		</p>
		<pre>{skeletonImportExample}</pre>
		<p>{m.demo_typography_kbd()} <kbd class="kbd">Ctrl</kbd> + <kbd class="kbd">K</kbd></p>
	</section>

	<!-- Form -->
	<section class="space-y-4">
		<h2 class="h2 border-b border-surface-200-800 pb-2">{m.demo_form()}</h2>
		<Card>
			<div class="space-y-4">
				<Input label={m.demo_label_name()} placeholder={m.demo_placeholder_name()} />
				<Input label={m.demo_label_email()} type="email" placeholder={m.demo_placeholder_email()} error={m.demo_invalid_email()} />
				<Textarea label={m.demo_message()} placeholder={m.demo_placeholder_message()} rows={3} />
				<Select
					label={m.demo_category()}
					options={[
						{ value: '', label: m.demo_select_placeholder() },
						{ value: 'design', label: 'Design' },
						{ value: 'dev', label: 'Development' },
						{ value: 'marketing', label: 'Marketing' }
					]}
				/>
				<div class="flex flex-col gap-3">
					<Checkbox label={m.demo_agree_terms()} />
					<Toggle label={m.demo_enable_notifications()} />
				</div>
				<Button>{m.demo_submit()}</Button>
			</div>
		</Card>
	</section>

	<!-- Table -->
	<section class="space-y-4">
		<h2 class="h2 border-b border-surface-200-800 pb-2">{m.demo_table()}</h2>
		<Table
			columns={[
				{ key: 'name', label: m.demo_col_name() },
				{ key: 'role', label: m.demo_col_role() },
				{ key: 'status', label: m.demo_col_status() }
			]}
			rowKey="name"
			rows={[
				{ name: 'Alice', role: 'Developer', status: 'Active' },
				{ name: 'Bob', role: 'Designer', status: 'Away' },
				{ name: 'Charlie', role: 'PM', status: 'Active' }
			]}
		/>
	</section>

	<!-- Richer components: Accordion, Tabs, Avatar, Breadcrumb etc. are NOT
	     re-implemented here — use the official ones from @skeletonlabs/skeleton-svelte
	     (they ship keyboard + ARIA support): -->
	<section class="space-y-4">
		<h2 class="h2 border-b border-surface-200-800 pb-2">{m.demo_richer()}</h2>
		<p class="text-surface-500">
			{m.demo_richer_desc()}
			<code class="text-primary-600-400">@skeletonlabs/skeleton-svelte</code> —
			<code>{skeletonImportExample}</code>
		</p>
	</section>

	<!-- Theme -->
	<section class="space-y-4">
		<h2 class="h2 border-b border-surface-200-800 pb-2">{m.demo_theme()}</h2>
		<p class="text-surface-500">{m.demo_theme_desc()}</p>
		<ThemeToggle />
	</section>
</main>
