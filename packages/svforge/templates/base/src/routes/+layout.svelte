<script lang="ts">
	import './layout.css';
	import * as m from '#lib/paraglide/messages.js';
	import { Navbar } from '#lib/components/svforge/layout/index.js';
	import { Footer } from '#lib/components/svforge/layout/index.js';

	let { children } = $props();
</script>

<Navbar links={[{ href: '/demo-ui', label: m.nav_components() }]} />

{@render children()}

<Footer links={[{ href: '/demo-ui', label: m.nav_components() }]} />
