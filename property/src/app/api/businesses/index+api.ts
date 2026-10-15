import { checkAuth } from '@/shared/services/apiAuth';
import { serverSupabase } from '@/shared/services/supabase';

export async function POST(request: Request) {
  try {
    const auth = await checkAuth(request);

    if (!auth) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const id = body?.id;

    // Business Isolation: If using a business-specific key, only allow fetching that business
    if (auth.business_id && id && id !== auth.business_id) {
      return Response.json(
        { error: 'Unauthorized: Business ID mismatch' },
        { status: 403 },
      );
    }

    // Force ID if the key is business-specific
    const targetId = auth.business_id || id;

    const businessCols =
      'id, name, address, phone, email, logo_url, latitude, longitude, metadata';

    const propertyCols = 'id, name, status, location, latitude, longitude';

    const houseCols =
      'id, property_id, house_number, type, monthly_rent, is_serviceable, status, amenities, photos';

    const selectString = `
      ${businessCols},
      properties(${propertyCols}),
      houses(${houseCols})
    `;

    const baseQuery = serverSupabase
      .from('businesses')
      .select(selectString)
      .eq('deleted', false);

    // Single business
    if (targetId) {
      const { data: business, error } = await baseQuery.eq('id', targetId).single();

      if (error) {
        console.error('Error fetching business:', error);

        return Response.json({ error: error.message }, { status: 500 });
      }

      // Block access to businesses that have not enabled API exposure
      if (!(business as any)?.metadata?.api_enabled) {
        return Response.json(
          { error: 'Forbidden: This business is not exposed via the API' },
          { status: 403 },
        );
      }

      if (business?.houses) {
        (business as any).houses = business.houses.filter(
          (h: any) => h.status === 'available',
        );
      }

      // Strip metadata before returning
      const businessData = { ...(business as any) };
      delete businessData.metadata;
      return Response.json(businessData);
    }

    // All businesses
    const { data: businesses, error } = await baseQuery;

    if (error) {
      console.error('Error fetching businesses:', error);

      return Response.json({ error: error.message }, { status: 500 });
    }

    const refinedBusinesses =
      businesses
        ?.filter((b: any) => b.metadata?.api_enabled === true)
        .map(({ metadata: _meta, ...b }: any) => ({
          ...b,
          houses: b.houses?.filter((h: any) => h.status === 'available') || [],
        })) || [];

    return Response.json(refinedBusinesses);
  } catch (err: any) {
    console.error('Unexpected error in businesses API:', err);

    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
