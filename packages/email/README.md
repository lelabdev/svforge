# @svforge/email

Transactional emails for SVForge projects via Resend. Adds a `sendEmail()` helper, Resend client setup, and reusable email templates.

## Installation

```bash
npx sv add @svforge/email
```

## Deployment profile

Supported: `long-lived-node`, `serverless`, `edge`, `separate-worker`. Unsupported: none. Trigger delivery from a request or a dedicated worker; keep `RESEND_API_KEY` server-side.

## Setup

The add-on appends a placeholder to the root `.env.example`. Copy it to `.env` (or add it to your existing file) and replace the placeholder with your Resend API key:

```bash
RESEND_API_KEY=your_resend_api_key
```

## Usage

```ts
import { sendEmail } from '$lib/server/email';
import { welcomeEmailHtml } from '$lib/server/templates';

await sendEmail({
  to: 'user@example.com',
  subject: 'Welcome!',
  html: welcomeEmailHtml('Alice')
});
```

## API

### `sendEmail(options)`

Sends an email via Resend.

| Parameter | Type | Default |
|-----------|------|---------|
| `to` | `string \| string[]` | — |
| `subject` | `string` | — |
| `html` | `string` | — |
| `from` | `string` | `noreply@example.com` |

## Templates

Pre-built HTML email templates:

- **`welcomeEmailHtml(name)`** — welcome email for new users
- **`resetPasswordEmailHtml(resetUrl)`** — password reset with styled CTA button

```ts
import { welcomeEmailHtml, resetPasswordEmailHtml } from '$lib/server/templates';
```

## What's included

- `$lib/server/email.ts` — Resend client + `sendEmail()` helper
- `$lib/server/templates/` — welcome and reset-password email templates

## Dependencies

- `resend` — official Resend Node.js SDK
