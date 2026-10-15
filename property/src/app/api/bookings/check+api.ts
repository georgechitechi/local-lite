import { checkAuth } from '@/shared/services/apiAuth';
import { serverSupabase } from '@/shared/services/supabase';
import { normalizePhoneNumber } from '@/shared/utils/helper';

/**
 * Booking lookup and verification API
 */

interface BookingCheckResult {
  exists: boolean;
  message?: string;
  booking?: {
    id: string;
    business_id: string;
    name: string;
    email: string;
    status: string;
    tenant_id?: string;
    user_id?: string;
    tenant?: Record<string, unknown>;
    latest_contract?: Record<string, unknown>;
    recent_receipts?: Record<string, unknown>[];
    [key: string]: unknown;
  };
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-api-key, Authorization',
};

export async function OPTIONS() {
  return new Response(null, { headers: corsHeaders });
}

export async function POST(request: Request) {
  try {
    const auth = await checkAuth(request);

    if (!auth) {
      return Response.json(
        { error: 'Unauthorized' },
        { status: 401, headers: corsHeaders },
      );
    }

    const body = await request.json().catch(() => ({}));

    const email = body?.email?.toLowerCase()?.trim();
    const phone = normalizePhoneNumber(body?.phone);
    const requestedBusinessId = body?.business_id;

    if (!email && !phone) {
      return Response.json(
        { error: 'Email or phone is required' },
        { status: 400, headers: corsHeaders },
      );
    }

    // Business isolation check
    if (
      auth.business_id &&
      requestedBusinessId &&
      auth.business_id !== requestedBusinessId
    ) {
      return Response.json(
        { error: 'Unauthorized: Business ID mismatch' },
        { status: 403, headers: corsHeaders },
      );
    }

    const businessId = requestedBusinessId || auth.business_id;

    const { data: rawData, error } = await serverSupabase.rpc('check_booking_existence', {
      p_email: email || undefined,
      p_phone: phone || undefined,
      p_business_id: businessId || null,
    });

    const data = rawData as BookingCheckResult | null;

    if (error) {
      console.error('Error calling check_booking_existence:', error);

      return Response.json(
        { error: error.message },
        { status: 500, headers: corsHeaders },
      );
    }

    if (!data?.exists) {
      const status = data?.message === 'Invalid credentials' ? 401 : 404;

      return Response.json(data || { exists: false }, { status, headers: corsHeaders });
    }

    // extra safety check
    if (
      auth.business_id &&
      data.booking &&
      data.booking.business_id !== auth.business_id
    ) {
      return Response.json(
        {
          exists: false,
          message: 'Booking not found',
        },
        { status: 404, headers: corsHeaders },
      );
    }

    return Response.json(data, { headers: corsHeaders });
  } catch (err) {
    console.error('Unexpected error in bookings API:', err);

    return Response.json(
      { error: 'Internal Server Error' },
      { status: 500, headers: corsHeaders },
    );
  }
}
