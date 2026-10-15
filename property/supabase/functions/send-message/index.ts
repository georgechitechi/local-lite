// @ts-nocheck
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import postgres from 'https://deno.land/x/postgresjs@v3.3.4/mod.js';
import { forwardToRelay } from '../_shared/email.ts';
import {
  errorResponse,
  getClientContext,
  handleCors,
  successResponse,
} from '../_shared/index.ts';
import { sendGenericSMS } from '../_shared/sms.ts';

console.log('[send-message] Getting DB URL');
const databaseUrl = Deno.env.get('SUPABASE_DB_URL') || '';
const sql = postgres(databaseUrl);
console.log('[send-message] Postgres client initialized');

// ==========================================
// EMAIL LOGIC (Queues to pgmq)
// ==========================================
async function handleSingleEmail(msg: any) {
  console.log('[send-message] Handling single email', msg.subject);
  if (!msg.to || !msg.subject || !msg.html) {
    return errorResponse('Missing required fields for email', 400);
  }
  try {
    const queueMsg = { ...msg, channel: 'email' };
    await sql`SELECT * FROM pgmq.send('bulk_messages', ${queueMsg as any})`;
    return successResponse({ message: 'Email queued successfully!' });
  } catch (error: any) {
    console.error('Failed to queue email:', error);
    throw error;
  }
}

async function handleBulkEmails(messages: any[]) {
  let queuedCount = 0;
  let failedCount = 0;
  const errors: any[] = [];
  const validMessages = [];

  for (const msg of messages) {
    if (!msg.to || !msg.subject || !msg.html) {
      failedCount++;
      errors.push({ to: msg.to, error: 'Missing required fields' });
      continue;
    }
    validMessages.push({ ...msg, channel: 'email' });
  }

  if (validMessages.length > 0) {
    try {
      for (const msg of validMessages) {
        await sql`SELECT * FROM pgmq.send('bulk_messages', ${msg as any})`;
      }
      queuedCount = validMessages.length;
    } catch (e: any) {
      console.error('Failed to queue bulk emails:', e);
      failedCount += validMessages.length;
      errors.push({ error: 'Failed to queue messages', details: e.message || String(e) });
    }
  }

  return successResponse({
    message: 'Bulk emails queued successfully',
    queuedCount,
    failedCount,
    errors,
  });
}

// ==========================================
// SMS LOGIC (Synchronous)
// ==========================================
async function handleSMS(msg: any) {
  const { to, message, senderId } = msg;

  if (!to || !message) {
    return errorResponse('Missing "to" or "message" parameter for SMS', 400);
  }

  if (Deno.env.get('SMS_GATEWAY_URL')) {
    return await sendGenericSMS(to, message, senderId);
  }

  const relayRes = await forwardToRelay({ ...msg, channel: 'sms' });
  if (relayRes) {
    const data = await relayRes.json().catch(() => ({}));
    return relayRes.ok ? successResponse(data) : errorResponse(data, relayRes.status);
  }

  return errorResponse('SMS Gateway URL (SMS_GATEWAY_URL) or relay not configured', 500);
}

// ==========================================
// MAIN ROUTER
// ==========================================
serve(async req => {
  console.log('[send-message] Incoming request:', req.method, req.url);
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const ctx = await getClientContext(req);
    if (ctx.error && !ctx.isInternal) return errorResponse(ctx.error, 401);

    let reqBody;
    try {
      reqBody = await req.json();
      console.log('[send-message] Request body parsed successfully');
    } catch (e) {
      console.error('[send-message] JSON parse error:', e);
      return errorResponse('Invalid JSON', 400);
    }

    const channel = reqBody.channel || 'email';

    if (channel === 'email') {
      return await handleSingleEmail(reqBody);
    } else if (channel === 'bulk_email' && Array.isArray(reqBody.messages)) {
      return await handleBulkEmails(reqBody.messages);
    } else if (channel === 'sms') {
      return await handleSMS(reqBody);
    } else {
      return errorResponse(`Unsupported channel: ${channel}`, 400);
    }
  } catch (error: any) {
    console.error('Failed to process message request:', error);
    return errorResponse(
      error.message || String(error),
      error.message === 'Unauthorized' || error.message === 'Missing Authorization header'
        ? 401
        : 500,
    );
  }
});
