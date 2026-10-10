<script lang="ts">
    import { cn } from '$lib/utils/cn';
    interface Props {
        name: string;
        size?: 'sm' | 'md' | 'lg';
        class?: string;
    }
    let { name, size = 'md', class: className }: Props = $props();
    const initial = $derived(name[0]?.toUpperCase() ?? '?');
    const sizes = { sm: 'w-7 h-7 text-xs', md: 'w-8 h-8 text-sm', lg: 'w-12 h-12 text-lg' };
</script>

<div class={cn('rounded-full bg-primary-100-900 flex items-center justify-center font-bold text-primary-950-50', sizes[size], className)}>
    {initial}
</div>
