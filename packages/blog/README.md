# @svforge/blog

MDsveX blog module for SvelteForge. Adds a fully-functional blog with post list and article pages to your SvelteKit project.

## Install

```bash
npx sv add @svforge/blog
```

This will:
- Install and configure [MDsveX](https://mdsvex.pngwn.io/)
- Create `src/posts/` directory with a welcome post
- Add `/blog` (post list) and `/blog/[slug]` (article) routes
- Add `src/lib/utils/posts.ts` for post management

## Deployment profile

Supported: `long-lived-node`, `serverless`, `edge`, `separate-worker`. Unsupported: none; the module has no persistent runtime requirement.

## Create a Post

Create `.md` files in `src/posts/`:

```bash
touch src/posts/my-post.md
```

### Frontmatter Format

Each post must include frontmatter at the top:

```yaml
---
title: My Post Title
date: 2025-01-15
excerpt: A short description shown in the post list
tags: [svelte, tutorial]
---

Write your content here in Markdown...
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | Yes | Post title |
| `date` | string | Yes | Publication calendar date (YYYY-MM-DD), independent of timezone |
| `excerpt` | string | Yes | Short description for post list |
| `tags` | string[] | Yes | Tags displayed as badges |

## Routes

| Route | Description |
|-------|-------------|
| `/blog` | Post list — all posts sorted by date (newest first) |
| `/blog/[slug]` | Individual article page |

## MDsveX

Posts are `.md` files processed by MDsveX, which means you can use:
- Standard Markdown (bold, italic, lists, links, images)
- Code blocks with syntax highlighting
- Svelte components inside Markdown

## File Structure

```
src/
├── posts/
│   └── welcome.md        ← Your posts live here
├── lib/
│   └── utils/
│       ├── posts.ts       ← Post queries (getAllPosts, getPost)
│       └── post-date.ts   ← Locale-aware calendar-date formatting
└── routes/
    └── blog/
        ├── +page.svelte       ← Post list page
        ├── +page.server.ts    ← Post list loader
        └── [slug]/
            ├── +page.svelte   ← Article page
            └── +page.server.ts ← Article loader
```

## License

MIT
