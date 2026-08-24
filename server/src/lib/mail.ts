import { config } from '../config.js';

/**
 * Outbound mail. Primary transport is the ForwardEmail REST API
 * (https://forwardemail.net — POST /v1/emails, Basic auth with the API key as
 * username); plain SMTP via nodemailer is the fallback, and with neither
 * configured callers get { sent: false } and typically log the link instead.
 */

export interface MailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface MailResult {
  sent: boolean;
  provider?: 'forwardemail' | 'smtp';
  error?: string;
}

export async function sendMail(input: MailInput): Promise<MailResult> {
  if (config.forwardEmail.apiKey) {
    try {
      // API key as Basic-auth username with empty password, per ForwardEmail docs
      const auth = Buffer.from(`${config.forwardEmail.apiKey}:`).toString('base64');
      const res = await fetch('https://api.forwardemail.net/v1/emails', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Basic ${auth}` },
        body: JSON.stringify({
          from: config.forwardEmail.from,
          to: input.to,
          subject: input.subject,
          text: input.text,
          ...(input.html ? { html: input.html } : {}),
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) return { sent: true, provider: 'forwardemail' };
      const detail = await res.text().catch(() => '');
      console.error(`[mail] forwardemail error ${res.status}: ${detail.slice(0, 300)}`);
    } catch (e: any) {
      console.error(`[mail] forwardemail request failed: ${e.message}`);
    }
  }
  if (config.smtp.host) {
    try {
      const nodemailer = await import('nodemailer');
      const transport = nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
      });
      await transport.sendMail({ from: config.smtp.from, to: input.to, subject: input.subject, text: input.text, html: input.html });
      return { sent: true, provider: 'smtp' };
    } catch (e: any) {
      console.error(`[mail] smtp failed: ${e.message}`);
    }
  }
  return { sent: false };
}

/** Minimal inline-styled HTML wrapper so transactional emails don't look raw. */
export function htmlEmail(title: string, bodyHtml: string, cta?: { label: string; url: string }): string {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f5f8;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c2130;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:12px;padding:28px;border:1px solid #e4e7ee;">
      <tr><td style="font-size:18px;font-weight:700;padding-bottom:14px;">${title}</td></tr>
      <tr><td style="font-size:14px;line-height:1.6;color:#3c4257;">${bodyHtml}</td></tr>
      ${
        cta
          ? `<tr><td style="padding-top:20px;"><a href="${cta.url}" style="display:inline-block;background:#4f6ef7;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 22px;border-radius:8px;">${cta.label}</a></td></tr>
             <tr><td style="padding-top:14px;font-size:12px;color:#8891a5;word-break:break-all;">Or paste this link: ${cta.url}</td></tr>`
          : ''
      }
      <tr><td style="padding-top:22px;font-size:11px;color:#a2aaba;">Sent by SET — Strategic Enablement Toolkit</td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}
