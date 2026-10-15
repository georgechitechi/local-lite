// @ts-nocheck
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';
import { formatEmailData } from '../_shared/email.ts';
import { errorResponse, handleCors, successResponse } from '../_shared/index.ts';
import { sendGenericSMS } from '../_shared/sms.ts';

function validateRelayAuth(req: Request): boolean {
  const apiKey = req.headers.get('x-api-key');
  const authHeader = req.headers.get('Authorization');
  const bearerToken = authHeader?.startsWith('Bearer ')
    ? authHeader.substring(7).trim()
    : null;

  const expectedKey = Deno.env.get('APP_SECRET_KEY');

  if (!expectedKey) {
    console.warn('[messaging-service] APP_SECRET_KEY is not configured on relay server');
    return false;
  }

  return apiKey === expectedKey || bearerToken === expectedKey;
}

function createCentralEmailClient() {
  const hostname =
    Deno.env.get('CENTRAL_SMTP_HOSTNAME') || Deno.env.get('SMTP_HOSTNAME') || '';
  const port = Number(
    Deno.env.get('CENTRAL_SMTP_PORT') || Deno.env.get('SMTP_PORT') || '465',
  );
  const username =
    Deno.env.get('CENTRAL_SMTP_USERNAME') || Deno.env.get('SMTP_USERNAME') || '';
  const password =
    Deno.env.get('CENTRAL_SMTP_PASSWORD') || Deno.env.get('SMTP_PASSWORD') || '';

  return new SMTPClient({
    connection: {
      hostname,
      port,
      tls: port === 465,
      auth: {
        username,
        password,
      },
    },
  });
}

serve(async req => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  if (!validateRelayAuth(req)) {
    return errorResponse(
      'Unauthorized: Invalid or missing relay authentication key',
      401,
    );
  }

  try {
    const payload = await req.json().catch(() => null);
    if (!payload) {
      return errorResponse('Invalid JSON body', 400);
    }

    const channel = payload.channel || 'email';

    // -------------------------------------------------------------
    // Email Dispatch (Central SMTP)
    // -------------------------------------------------------------
    if (channel === 'email') {
      const { to, subject, html } = payload;
      if (!to || !subject || !html) {
        return errorResponse('Missing required email fields (to, subject, html)', 400);
      }

      const senderFrom =
        payload.from ||
        Deno.env.get('CENTRAL_SMTP_FROM') ||
        Deno.env.get('SMTP_FROM') ||
        '';

      const emailData = formatEmailData(payload);
      if (senderFrom) {
        emailData.from = senderFrom;
      }

      const emailClient = createCentralEmailClient();
      await emailClient.send(emailData);
      await emailClient.close();

      return successResponse({
        success: true,
        message: 'Email dispatched via messaging service',
        to: emailData.to,
        subject,
      });
    }

    // -------------------------------------------------------------
    // SMS Dispatch (Generic SMS Gateway)
    // -------------------------------------------------------------
    if (channel === 'sms') {
      const { to, message, senderId } = payload;
      if (!to || !message) {
        return errorResponse('Missing required SMS fields (to, message)', 400);
      }

      return await sendGenericSMS(to, message, senderId);
    }

    return errorResponse(`Unsupported channel: ${channel}`, 400);
  } catch (err: any) {
    console.error('[messaging-service] Error dispatching notification:', err);
    return errorResponse(err.message || String(err), 500);
  }
});
