// @ts-nocheck
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import postgres from 'https://deno.land/x/postgresjs@v3.3.4/mod.js';
import { createEmailClient, formatEmailData, forwardToRelay } from '../_shared/email.ts';
import {
  errorResponse,
  getClientContext,
  handleCors,
  successResponse,
} from '../_shared/index.ts';
import { sendGenericSMS } from '../_shared/sms.ts';

const databaseUrl = Deno.env.get('SUPABASE_DB_URL') || '';
const sql = postgres(databaseUrl);

async function handleQueueProcessing() {
  const messages = await sql`
    SELECT * FROM pgmq.read('bulk_messages', 30, 50);
  `;

  if (messages.length === 0) {
    return successResponse({ status: 'empty' });
  }

  const processedMsgIds: string[] = [];

  for (const msg of messages) {
    const { channel } = msg.message;

    try {
      if (channel === 'email') {
        const { to, subject, html } = msg.message;
        if (!to || !subject || !html) {
          console.error(
            `Message ${msg.msg_id} missing required email fields:`,
            msg.message,
          );
          await sql`SELECT pgmq.archive('bulk_messages'::text, ${msg.msg_id}::bigint)`;
          processedMsgIds.push(msg.msg_id);
          continue;
        }

        // 1. Try local SMTP if configured
        if (Deno.env.get('SMTP_HOSTNAME')) {
          const emailData = formatEmailData(msg.message);
          const emailClient = createEmailClient();
          await emailClient.send(emailData);
          await emailClient.close();
          await sql`SELECT pgmq.archive('bulk_messages'::text, ${msg.msg_id}::bigint)`;
          processedMsgIds.push(msg.msg_id);
          continue;
        }

        // 2. Fallback to central relay
        const relayRes = await forwardToRelay({ ...msg.message, channel: 'email' });
        if (relayRes?.ok) {
          await sql`SELECT pgmq.archive('bulk_messages'::text, ${msg.msg_id}::bigint)`;
          processedMsgIds.push(msg.msg_id);
          continue;
        }

        if (!relayRes) {
          console.warn(
            `Message ${msg.msg_id} skipped: Neither SMTP nor Relay configured.`,
          );
          await sql`SELECT pgmq.archive('bulk_messages'::text, ${msg.msg_id}::bigint)`;
          processedMsgIds.push(msg.msg_id);
        }
      } else if (channel === 'sms') {
        const { to, message } = msg.message;
        if (!to || !message) {
          console.error(
            `Message ${msg.msg_id} missing required SMS fields:`,
            msg.message,
          );
          await sql`SELECT pgmq.archive('bulk_messages'::text, ${msg.msg_id}::bigint)`;
          processedMsgIds.push(msg.msg_id);
          continue;
        }

        let response;
        if (Deno.env.get('SMS_GATEWAY_URL')) {
          response = await sendGenericSMS(to, message, msg.message?.senderId);
        } else {
          response = await forwardToRelay({ ...msg.message, channel: 'sms' });
        }

        if (response && !response.ok) {
          console.error(`Failed to send SMS to ${to}:`, await response.text());
        } else {
          await sql`SELECT pgmq.archive('bulk_messages'::text, ${msg.msg_id}::bigint)`;
          processedMsgIds.push(msg.msg_id);
        }
      } else {
        console.error(`Message ${msg.msg_id} has unknown channel: ${channel}`);
        await sql`SELECT pgmq.archive('bulk_messages'::text, ${msg.msg_id}::bigint)`;
        processedMsgIds.push(msg.msg_id);
      }
    } catch (e) {
      console.error(`Failed to process message ${msg.msg_id} (channel: ${channel}):`, e);
    }
  }

  return successResponse({ processed: processedMsgIds.length });
}

serve(async req => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  try {
    const ctx = await getClientContext(req);
    if (ctx.error && !ctx.isInternal) return errorResponse(ctx.error, 401);

    const reqBody = await req.json();

    if (reqBody && reqBody.action === 'process_queue') {
      return await handleQueueProcessing();
    }

    return errorResponse('Invalid action. Only process_queue is supported.', 400);
  } catch (error: any) {
    console.error('Error processing messages queue:', error);
    return errorResponse(
      error.message || String(error),
      error.message === 'Unauthorized' || error.message === 'Missing Authorization header'
        ? 401
        : 500,
    );
  }
});
