import { checkAuth } from '@/shared/services/apiAuth';
import { serverSupabase } from '@/shared/services/supabase';
import { normalizePhoneNumber } from '@/shared/utils/helper';

interface BookingSubmitResult {
  success?: boolean;
  error?: string;
  message?: string;
  id?: string;
  [key: string]: unknown;
}

/**
 * POST /api/bookings
 * Saves a new booking request to the database.
 */
export async function POST(request: Request) {
  try {
    const auth = await checkAuth(request);
    if (!auth) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const requestedBusinessId = body.business_id;

    // Business Isolation: If the key is restricted, it MUST match the requested business_id
    if (
      auth.business_id &&
      requestedBusinessId &&
      auth.business_id !== requestedBusinessId
    ) {
      return Response.json(
        { error: 'Unauthorized: Business ID mismatch' },
        { status: 403 },
      );
    }

    // Use the business_id from request if available, otherwise fallback to the key's business
    const businessId = requestedBusinessId || auth.business_id;

    // Basic validation
    if (!body.name) {
      return Response.json({ error: 'Name is required' }, { status: 400 });
    }

    if (!body.phone) {
      return Response.json({ error: 'Phone is required' }, { status: 400 });
    }

    if (!body.email) {
      return Response.json({ error: 'Email is required' }, { status: 400 });
    }

    const email = body.email.toLowerCase().trim();

    // Call the database function to handle upsert and RLS
    const { data: rawData, error } = await serverSupabase.rpc('submit_booking_request', {
      p_name: body.name,
      p_phone: normalizePhoneNumber(body.phone),
      p_email: email,
      p_gender: body.gender,
      p_marital_status: body.marital_status,
      p_nationality: body.nationality,
      p_address: body.address,
      p_next_of_kin: body.next_of_kin || {},
      p_business_id: businessId,
      p_property_id: body.property_id,
      p_house_id: body.house_id,
    });
    const data = rawData as BookingSubmitResult | null;

    if (error) {
      console.error('Supabase RPC Error:', JSON.stringify(error, null, 2));
      return Response.json(
        {
          error: error.message,
          details: error,
        },
        { status: 500 },
      );
    }

    if (data && data.success === false) {
      return Response.json(
        {
          error: data.error || 'Failed to submit booking',
          details: data,
        },
        { status: 400 },
      );
    }

    return Response.json(
      {
        success: true,
        message: data?.message || 'Booking request processed successfully',
        id: data?.id,
      },
      { status: 201 },
    );
  } catch (err: any) {
    console.error('Unexpected error in bookings API:', err);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
