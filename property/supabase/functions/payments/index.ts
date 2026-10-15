// @ts-nocheck
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { formatDateForDB } from '../_shared/date-utils.ts';
import {
  errorResponse,
  getInternalHeaders,
  handleCors,
  successResponse,
} from '../_shared/index.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') || '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
);

// --- Utilities ---
function getTimestamp() {
  const date = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    date.getFullYear() +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  );
}

function buildCallbackUrl(
  baseUrl: string,
  params: Record<string, string | undefined | null>,
) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      searchParams.append(key, String(value));
    }
  }
  const queryString = searchParams.toString();
  if (!queryString) return baseUrl;
  return baseUrl.includes('?')
    ? `${baseUrl}&${queryString}`
    : `${baseUrl}?${queryString}`;
}

function extractTransactionDetails(providerName: string, payload: any) {
  let amount = null;
  let phoneNumber = null;
  let providerRefNumber = null;

  try {
    const callbackData = payload?.Body?.stkCallback || payload;
    if (callbackData?.CallbackMetadata?.Item) {
      const items = callbackData.CallbackMetadata.Item;
      amount = items.find((i: any) => i.Name === 'Amount')?.Value || null;
      providerRefNumber =
        items.find((i: any) => i.Name === 'MpesaReceiptNumber')?.Value || null;
      phoneNumber = items.find((i: any) => i.Name === 'PhoneNumber')?.Value || null;
    } else {
      amount = payload?.amount || null;
      phoneNumber = payload?.phone_number || payload?.phone || null;
      providerRefNumber =
        payload?.mpesa_receipt_number || payload?.transaction_id || null;
    }
  } catch (err) {
    console.warn(`[${providerName}] Error extracting details:`, err);
  }

  return { amount, phoneNumber, providerRefNumber };
}

// --- Payment Initiation ---

async function initiateDarajaPayment(body: any) {
  const { phone, amount, business_id, user_id, tenant_id, contract_id, name } = body;
  console.log('[Daraja] Initiating payment');

  const consumerKey = Deno.env.get('DARAJA_CONSUMER_KEY');
  const consumerSecret = Deno.env.get('DARAJA_CONSUMER_SECRET');
  const shortCode = Deno.env.get('DARAJA_SHORTCODE') || '174379';
  const passkey = Deno.env.get('DARAJA_PASSKEY');
  const baseUrl = Deno.env.get('DARAJA_API_URL') || 'https://api.safaricom.co.ke';

  if (!consumerKey || !consumerSecret || !passkey) {
    throw new Error('Daraja credentials missing');
  }

  // 1. Get Token
  const auth = btoa(`${consumerKey}:${consumerSecret}`);
  const tokenResponse = await fetch(
    `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
    {
      method: 'GET',
      headers: { Authorization: `Basic ${auth}` },
    },
  );
  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok) {
    console.error('[Daraja] Token fetch failed');
    throw new Error(`Daraja token failed: ${JSON.stringify(tokenData)}`);
  }
  console.log('[Daraja] Token fetched successfully');

  // 2. STK Push
  const timestamp = getTimestamp();
  const password = btoa(`${shortCode}${passkey}${timestamp}`);
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  let callbackUrl =
    Deno.env.get('DARAJA_CALLBACK_URL') ||
    `${supabaseUrl}/functions/v1/payments/callback`;

  callbackUrl = buildCallbackUrl(callbackUrl, {
    business_id,
    user_id,
    tenant_id,
    contract_id,
    name,
  });

  const stkPayload = {
    BusinessShortCode: shortCode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: Deno.env.get('DARAJA_TRANSACTION_TYPE') || 'CustomerPayBillOnline',
    Amount: Math.round(amount),
    PartyA: phone.replace('+', '').trim(),
    PartyB: Deno.env.get('DARAJA_PARTY_B') || shortCode,
    PhoneNumber: phone.replace('+', '').trim(),
    CallBackURL: callbackUrl,
    AccountReference: 'Booking',
    TransactionDesc: 'Payment',
  };

  const stkResponse = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(stkPayload),
  });

  const stkData = await stkResponse.json();

  if (!stkResponse.ok || stkData.ResponseCode !== '0') {
    console.error('[Daraja] STK Push failed');
    throw new Error(
      stkData.errorMessage || stkData.customerMessage || 'Daraja STK Push failed',
    );
  }

  return stkData;
}

// --- Payment Callbacks ---

async function savePaymentRecords(
  providerName: string,
  isSuccess: boolean,
  transactionId: string,
  rawResult: any,
  payload: any,
) {
  const { amount, phoneNumber, providerRefNumber } = extractTransactionDetails(
    providerName,
    payload,
  );
  const businessId = payload?.business_id || null;
  const userId = payload?.user_id || null;
  const tenantId = payload?.tenant_id || null;
  const contractId = payload?.contract_id || null;

  if (!isSuccess) {
    return null;
  }

  // 1. Save to transactions table
  const { data: existingTx } = await supabase
    .from('transactions')
    .select('id')
    .eq('transaction_reference', transactionId)
    .maybeSingle();

  let txError;
  if (existingTx) {
    const { error } = await supabase
      .from('transactions')
      .update({
        provider_reference: providerRefNumber,
        status: rawResult?.toString() || (isSuccess ? 'SUCCESS' : 'FAILED'),
        is_success: isSuccess,
        raw_payload: payload || rawResult,
      })
      .eq('id', existingTx.id);
    txError = error;
  } else {
    const { error } = await supabase.from('transactions').insert({
      business_id: businessId,
      user_id: userId,
      tenant_id: tenantId,
      contract_id: contractId,
      provider: providerName,
      transaction_reference: transactionId,
      provider_reference: providerRefNumber,
      amount: amount ? Number(amount) : null,
      phone_number: phoneNumber ? String(phoneNumber) : null,
      status: rawResult?.toString() || (isSuccess ? 'SUCCESS' : 'FAILED'),
      is_success: isSuccess,
      raw_payload: payload || rawResult,
    });
    txError = error;
  }

  if (txError) {
    console.error(
      `[${providerName}] DB Insert into transactions Error:`,
      txError.message,
    );
  } else {
    console.log(`[${providerName}] Saved to transactions table`);
  }
  // 2. Save to payment_messages table (for ALL callbacks, success or failure)
  // Standardized message content
  const formattedAmount = amount ? Number(amount).toFixed(2) : '0.00';
  const customerName = payload?.name || payload?.tenant_name || 'Customer';
  const phoneToUse = phoneNumber || payload?.phone || payload?.phone_number || 'Unknown';
  const receiptToUse = providerRefNumber || transactionId;
  const timeToUse = payload?.timestamp || new Date().toLocaleString();

  const messageToInsert = `Confirmed. KES. ${formattedAmount} from ${customerName} Phone No. ${phoneToUse} received via M-Pesa Ref. ${receiptToUse} on ${timeToUse}. Thank you.`;

  const { error: dbError } = await supabase.from('payment_messages').insert({
    business_id: businessId,
    user_id: userId,
    message_content: messageToInsert,
    transaction_date: formatDateForDB(new Date()),
    metadata: {
      provider: providerName,
      transaction_id: transactionId,
      is_success: isSuccess,
      raw_result: rawResult,
      ...payload,
    },
  });

  if (dbError) {
    console.error(
      `[${providerName}] DB Insert into payment_messages Error:`,
      dbError.message,
    );
  } else {
    console.log(`[${providerName}] Saved message to payment_messages table`);
  }

  return messageToInsert;
}

async function processCallback(
  providerName: string,
  isSuccess: boolean,
  transactionId: string,
  rawResult: any,
  payload?: any,
) {
  if (!transactionId) {
    throw new Error(`[${providerName}] No transaction ID found in payload`);
  }

  const notificationEmail = Deno.env.get('ADMIN_EMAIL') || 'info@ogsadmin.com';

  // Use the common function to save to both tables
  const savedMessageContent = await savePaymentRecords(
    providerName,
    isSuccess,
    transactionId,
    rawResult,
    payload,
  );

  if (isSuccess) {
    console.log(
      `[${providerName}] Payment Success! Sending email to ${notificationEmail}`,
    );

    const messageContent = savedMessageContent;

    const emailPayload = {
      channel: 'email',
      to: notificationEmail,
      subject: `New ${providerName} Payment Received`,
      html: [
        `<div style="font-family: sans-serif; font-size: 14px; line-height: 1.4;">`,
        `  <p style="white-space: pre-wrap;">${messageContent}</p>`,
        `</div>`,
      ].join(''),
    };

    try {
      const { error } = await supabase.functions.invoke('send-message', {
        body: emailPayload,
        headers: getInternalHeaders(),
      });
      if (error) throw error;
      console.log(`[${providerName}] Supabase send-message Response OK`);
    } catch (err: any) {
      console.error(`[${providerName}] Error sending email:`, err.message);
    }
  }

  return { ResultCode: 0, ResultDesc: 'Success' };
}

async function handleDarajaCallback(payload: any) {
  const callbackData = payload.Body?.stkCallback || payload;
  const resultCode = callbackData.ResultCode;
  const checkoutRequestId = callbackData.CheckoutRequestID;
  const isSuccess = resultCode === 0;

  if (isSuccess) console.log('[Daraja Callback] Processing successful callback');

  return processCallback('Daraja', isSuccess, checkoutRequestId, resultCode, payload);
}

// --- Router ---

serve(async req => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  const url = new URL(req.url);

  if (req.method === 'GET') {
    const txId = url.searchParams.get('txId');
    console.log(`[Payments Router] Polling requested for txId: ${txId}`);

    if (!txId) {
      console.warn(`[Payments Router] Polling failed: Missing txId`);
      return errorResponse('Missing txId', 400);
    }

    try {
      const { data, error } = await supabase
        .from('transactions')
        .select('is_success, status')
        .eq('transaction_reference', txId)
        .order('created_at', { ascending: false })
        .limit(1);

      if (error) {
        console.error(`[Payments Router] Polling DB Error:`, error);
        throw error;
      }

      const match = data?.[0];
      console.log(
        `[Payments Router] DB match for txId ${txId}:`,
        match || 'No record found',
      );

      const isPaid = match?.is_success === true || match?.status === 'SUCCESS';
      console.log(`[Payments Router] txId ${txId} isPaid status evaluated to: ${isPaid}`);

      return successResponse({
        success: true,
        is_paid: isPaid,
        found: !!match,
      });
    } catch (e: any) {
      return errorResponse(e.message, 500);
    }
  }

  try {
    const isCallback =
      url.pathname.endsWith('/callback') || url.pathname.endsWith('/callback/');
    console.log(
      `[Payments Router] Incoming request to path: ${url.pathname} | isCallback: ${isCallback}`,
    );

    let payload;
    try {
      payload = await req.json();
      console.log('[Payments Router] Request payload received');
    } catch {
      console.error(`[Payments Router] Failed to parse JSON payload`);
      return errorResponse('Invalid JSON payload', 400);
    }

    const queryParams = Object.fromEntries(url.searchParams);
    Object.assign(payload, queryParams);

    let result;
    if (isCallback) {
      // Handle Daraja Webhook Callback
      result = await handleDarajaCallback(payload);
    } else {
      // Handle STK Push Initiation
      const provider = payload.provider || 'daraja';
      if (provider === 'daraja') {
        result = await initiateDarajaPayment(payload);
      } else {
        throw new Error(`Unsupported provider: ${provider}`);
      }
    }

    return successResponse(result);
  } catch (error: any) {
    console.error('[Payments] Error:', error.message);
    return errorResponse(error.message, 400);
  }
});
