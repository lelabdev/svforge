<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import AdminLayout from '#lib/components/svforge/layout/AdminLayout.svelte';
	import { authClient } from '#lib/client/auth.js';

	let { data, children } = $props();

	async function handleSignOut() {
		await authClient.signOut();
		goto('/login');
	}
</script>

<AdminLayout currentPath={page.url.pathname} user={data.user} onSignOut={handleSignOut}>
	{@render children()}
</AdminLayout>
