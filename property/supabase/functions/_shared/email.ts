// @ts-nocheck
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

export const createEmailClient = () => {
  return new SMTPClient({
    connection: {
      hostname: Deno.env.get('SMTP_HOSTNAME') ?? '',
      port: Number(Deno.env.get('SMTP_PORT') ?? '465'),
      tls: true,
      auth: {
        username: Deno.env.get('SMTP_USERNAME') ?? '',
        password: Deno.env.get('SMTP_PASSWORD') ?? '',
      },
    },
  });
};

export const formatEmailData = (msg: any) => {
  const { to, subject, html, attachments, cc, bcc } = msg;
  const recipientEmails = Array.isArray(to) ? to : [to];
  const ccEmails = cc ? (Array.isArray(cc) ? cc : [cc]) : [];
  const bccEmails = bcc ? (Array.isArray(bcc) ? bcc : [bcc]) : [];

  const emailData: any = {
    from: Deno.env.get('SMTP_FROM') ?? '',
    to: recipientEmails,
    subject,
    html,
    cc: ccEmails.length > 0 ? ccEmails : undefined,
    bcc: bccEmails.length > 0 ? bccEmails : undefined,
  };

  if (attachments && Array.isArray(attachments)) {
    emailData.attachments = attachments.map((attachment: any) => ({
      filename: attachment.filename,
      content: attachment.content,
      encoding: attachment.encoding || 'base64',
    }));
  }

  return emailData;
};

export async function forwardToRelay(payload: any) {
  const baseUrl = Deno.env.get('CENTRAL_URL');
  const secretKey = Deno.env.get('APP_SECRET_KEY');
  if (!baseUrl) return null;

  const relayUrl = `${baseUrl}/functions/v1/messaging-service`;

  try {
    return await fetch(relayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': secretKey || '',
        ...(secretKey ? { Authorization: `Bearer ${secretKey}` } : {}),
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('[Relay] Failed to forward notification:', err);
    return null;
  }
}
