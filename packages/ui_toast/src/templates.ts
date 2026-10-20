// AUTO-GENERATED - DO NOT EDIT
export const files = {
  "/lib/components/svforge/ui/Toaster.svelte": "<script lang=\"ts\">\n\timport { Toast } from '@skeletonlabs/skeleton-svelte';\n\timport { toaster } from './toaster.ts';\n</script>\n\n<Toast.Group {toaster}>\n\t{#snippet children(toast)}\n\t\t<Toast {toast}>\n\t\t\t<Toast.Message>\n\t\t\t\t<Toast.Title>{toast.title}</Toast.Title>\n\t\t\t\t{#if toast.description}\n\t\t\t\t\t<Toast.Description>{toast.description}</Toast.Description>\n\t\t\t\t{/if}\n\t\t\t</Toast.Message>\n\t\t\t<Toast.CloseTrigger class=\"cursor-pointer\" />\n\t\t</Toast>\n\t{/snippet}\n</Toast.Group>\n",
  "/lib/components/svforge/ui/toaster.ts": "import { createToaster } from '@skeletonlabs/skeleton-svelte';\n\nexport const toaster = createToaster();\n"
};
