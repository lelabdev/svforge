<script lang="ts">
	let { data } = $props();
</script>

<h1>SVForge builder consumer fixture</h1>
<p data-testid="id">{data.id}</p>
<p data-testid="ok">{data.ok ? 'zod-ok' : 'zod-failed'} zod@{data.zodVersion}</p>
