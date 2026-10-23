<script lang="ts">
	import { cn } from '#lib/utils/cn.js';
	import * as m from '#lib/paraglide/messages.js';
	import { Card, AvatarInitial } from '#lib/components/svforge/ui/index.js';
	import { Badge } from '#lib/components/svforge/primitives/index.js';
	import { Button } from '#lib/components/svforge/primitives/index.js';
	import PageHeader from '#lib/components/svforge/layout/PageHeader.svelte';
	import { Users, ChartBar, Clock } from '#lib/icons/index.js';

	let { data } = $props();

	// #636: equivalent metrics share ONE card composition — only label, value,
	// icon and Skeleton tonal preset differ. Values are the real server counts
	// (`data.stats`) and stay untouched. Re-derived so Paraglide labels follow
	// the active locale.
	let metrics = $derived([
		{
			label: m.admin_total_users(),
			value: data.stats.totalUsers,
			icon: Users,
			tone: 'preset-tonal-primary'
		},
		{
			label: m.admin_active_sessions(),
			value: data.stats.activeSessions,
			icon: Clock,
			tone: 'preset-tonal-success'
		},
		{
			label: m.admin_this_week(),
			value: data.stats.newThisWeek,
			icon: ChartBar,
			tone: 'preset-tonal-secondary'
		}
	]);
</script>

<svelte:head>
	<title>{m.admin_title()}</title>
</svelte:head>

<div class="space-y-6">
	<!-- #636: the navigation already labels the current section, so the page
	     header carries the personal context instead of repeating the route
	     label as a second on-screen title. Actions keep the shared defaults
	     (#601). -->
	<PageHeader title={m.admin_welcome_back({ name: data.user.name })}>
		{#snippet actions()}
			<Button href="/admin/users">
				<Users size={16} class="mr-1" />
				{m.admin_manage_users()}
			</Button>
		{/snippet}
	</PageHeader>

	<!-- Metrics: label above, number as the anchor, tonal icon chip as accent.
	     The label reserves two lines from `md` up so the numbers of all three
	     cards share one baseline (equal card proportions, #636). #317: the
	     Skeleton tonal preset owns the chip's bg+fg pair. -->
	<div class="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
		{#each metrics as metric (metric.label)}
			{@const Icon = metric.icon}
			<Card variant="elevated" class="p-5">
				<div class="flex items-start justify-between gap-4">
					<div class="min-w-0">
						<p
							class="text-xs font-semibold uppercase leading-4 tracking-wide text-surface-700-300 md:min-h-8"
						>
							{metric.label}
						</p>
						<p class="mt-2 text-3xl font-semibold tabular-nums">{metric.value}</p>
					</div>
					<span
						class={cn(
							'grid size-11 shrink-0 place-items-center rounded-container',
							metric.tone
						)}
						aria-hidden="true"
					>
						<Icon size={22} />
					</span>
				</div>
			</Card>
		{/each}
	</div>

	<!-- Recent users: one intentional list container with aligned status
	     badges; the empty state is explicit instead of a bare card. -->
	<Card>
		{#snippet header()}
			<h3 class="h4">{m.admin_recent_users()}</h3>
		{/snippet}

		{#if data.recentUsers.length === 0}
			<p class="py-6 text-center text-sm text-surface-700-300">{m.users_none()}</p>
		{:else}
			<ul class="divide-y divide-surface-200-800">
				{#each data.recentUsers as u (u.id)}
					<li class="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
						<div class="flex min-w-0 items-center gap-3">
							<AvatarInitial name={u.name} />
							<div class="min-w-0">
								<p class="truncate text-sm font-medium">{u.name}</p>
								<p class="truncate text-xs text-surface-700-300">{u.email}</p>
							</div>
						</div>
						<Badge color={u.emailVerified ? 'success' : 'warning'} class="shrink-0">
							{u.emailVerified ? m.admin_verified() : m.admin_pending()}
						</Badge>
					</li>
				{/each}
			</ul>
		{/if}
	</Card>
</div>
