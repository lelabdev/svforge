import { Resend } from 'resend';
import * as env from '$app/env/private';

if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set');

const resend = new Resend(env.RESEND_API_KEY);

interface SendEmailOptions {
	to: string | string[];
	subject: string;
	html: string;
	from?: string;
}

export async function sendEmail({ to, subject, html, from = 'noreply@example.com' }: SendEmailOptions) {
	const { data, error } = await resend.emails.send({ from, to, subject, html });
	if (error) throw new Error(`Email send failed: ${error.message}`);
	return data;
}
