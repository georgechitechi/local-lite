// @ts-nocheck
import { errorResponse, successResponse } from './index.ts';

/**
 * Dispatches an SMS using a Generic HTTP / Webhook SMS Gateway.
 * Supports any commercial or custom provider (Twilio, Termii, Infobip, Plivo, etc.)
 * Configurable via Supabase Edge Function Secrets:
 * - SMS_GATEWAY_URL: Endpoint URL (e.g. https://api.provider.com/v1/sms/send)
 * - SMS_GATEWAY_METHOD: HTTP method (POST, GET, PUT; default: POST)
 * - SMS_GATEWAY_HEADERS: JSON object string of headers (e.g. {"Authorization": "Bearer ...", "Content-Type": "application/json"})
 * - SMS_GATEWAY_BODY: Custom JSON body or URL-encoded template with {{to}}, {{message}}, {{from}} placeholders
 * - SMS_GATEWAY_FROM: Default Sender ID / From number
 */
export async function sendGenericSMS(to: any, message: string, fromOverride?: string) {
  const gatewayUrl = Deno.env.get('SMS_GATEWAY_URL');
  if (!gatewayUrl) {
    return errorResponse('Generic SMS Gateway URL not configured (SMS_GATEWAY_URL)', 500);
  }

  const method = (Deno.env.get('SMS_GATEWAY_METHOD') || 'POST').toUpperCase();
  const headersRaw = Deno.env.get('SMS_GATEWAY_HEADERS');
  const bodyTemplate = Deno.env.get('SMS_GATEWAY_BODY');
  const defaultFrom = Deno.env.get('SMS_GATEWAY_FROM') || '';
  const from = fromOverride || defaultFrom;

  const toStr = Array.isArray(to) ? to.join(',') : String(to);

  // Initialize headers
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
  };

  let contentTypeSpecified = false;
  if (headersRaw) {
    try {
      const parsed = JSON.parse(headersRaw);
      for (const [k, v] of Object.entries(parsed)) {
        headers[k] = String(v);
        if (k.toLowerCase() === 'content-type') {
          contentTypeSpecified = true;
        }
      }
    } catch {
      // Fallback if user entered raw token (e.g. "Bearer eyJ..." or "Basic xyz")
      const trimmed = headersRaw.trim();
      if (
        trimmed.startsWith('Bearer ') ||
        trimmed.startsWith('Basic ') ||
        trimmed.startsWith('Token ')
      ) {
        headers.Authorization = trimmed;
      } else if (trimmed) {
        headers.Authorization = `Bearer ${trimmed}`;
      }
    }
  }

  const isFormUrlEncoded = Object.entries(headers).some(
    ([k, v]) =>
      k.toLowerCase() === 'content-type' &&
      v.includes('application/x-www-form-urlencoded'),
  );

  let finalUrl = gatewayUrl;
  let requestBody: any;

  // Helper for JSON escaping
  const escapeJsonVal = (str: string) => JSON.stringify(str).slice(1, -1);

  if (method === 'GET') {
    // If GET request, inject into URL placeholders or append query params
    if (finalUrl.includes('{{')) {
      finalUrl = finalUrl
        .replace(/\{\{\s*to\s*\}\}/g, encodeURIComponent(toStr))
        .replace(/\{\{\s*message\s*\}\}/g, encodeURIComponent(message))
        .replace(/\{\{\s*from\s*\}\}/g, encodeURIComponent(from));
    } else {
      const u = new URL(finalUrl);
      u.searchParams.set('to', toStr);
      u.searchParams.set('message', message);
      if (from) u.searchParams.set('from', from);
      finalUrl = u.toString();
    }
  } else {
    // POST / PUT / PATCH
    if (bodyTemplate) {
      if (isFormUrlEncoded) {
        requestBody = bodyTemplate
          .replace(/\{\{\s*to\s*\}\}/g, encodeURIComponent(toStr))
          .replace(/\{\{\s*message\s*\}\}/g, encodeURIComponent(message))
          .replace(/\{\{\s*from\s*\}\}/g, encodeURIComponent(from));
      } else {
        requestBody = bodyTemplate
          .replace(/\{\{\s*to\s*\}\}/g, escapeJsonVal(toStr))
          .replace(/\{\{\s*message\s*\}\}/g, escapeJsonVal(message))
          .replace(/\{\{\s*from\s*\}\}/g, escapeJsonVal(from));
        if (!contentTypeSpecified) {
          headers['Content-Type'] = 'application/json';
        }
      }
    } else {
      // Default standard JSON body
      if (!contentTypeSpecified) {
        headers['Content-Type'] = 'application/json';
      }
      requestBody = JSON.stringify({
        to: toStr,
        message,
        ...(from ? { from } : {}),
      });
    }
  }

  console.log(`[GenericSMS] Sending SMS to: ${toStr} via ${method} ${finalUrl}`);

  const response = await fetch(finalUrl, {
    method,
    headers,
    body: method !== 'GET' ? requestBody : undefined,
  });

  let data;
  try {
    data = await response.json();
  } catch {
    data = { raw: await response.text() };
  }

  if (response.ok) {
    return successResponse(data);
  } else {
    return errorResponse(data, response.status);
  }
}

/**
 * Smart dispatcher for SMS. Dispatches via Generic SMS Gateway.
 */
export async function sendSMS(
  to: any,
  message: string,
  options?: { provider?: string; senderId?: string },
) {
  const senderId = options?.senderId;
  return await sendGenericSMS(to, message, senderId);
}
