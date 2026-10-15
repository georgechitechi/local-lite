// @ts-nocheck
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createEmailClient, formatEmailData } from '../_shared/email.ts';
import {
  errorResponse,
  getClientContext,
  getServiceRoleClient,
  handleCors,
  successResponse,
} from '../_shared/index.ts';
import {
  checkFinancialAnomalies,
  checkLogicalAnomalies,
  checkQualityAnomalies,
  checkRelationshipAnomalies,
  checkStatusAnomalies,
} from './checkers.ts';
import { buildIntegrityEmail } from './email.ts';
import type { AnomaliesList, DBData, Fix } from './types.ts';

async function processBusinessIntegrity(
  supabaseClient: any,
  business_id: string,
  action: string,
) {
  // 1. Fetch Data
  const [
    { data: tenants },
    { data: houses },
    { data: contracts },
    { data: receipts },
    { data: properties },
    { data: expenses },
    { data: paymentMessages },
    { data: bookings },
    { data: maintenanceReqs },
    { data: promotionList },
  ] = await Promise.all([
    supabaseClient
      .from('tenants')
      .select('id, name, status, phone, email')
      .eq('business_id', business_id),
    supabaseClient
      .from('houses')
      .select('id, house_number, status, property_id, is_serviceable')
      .eq('business_id', business_id),
    supabaseClient
      .from('contracts')
      .select('id, tenant_id, house_id, status, start_date, end_date, rent_amount')
      .eq('business_id', business_id),
    supabaseClient
      .from('receipts')
      .select(
        'id, tenant_id, contract_id, payment_period, payment_date, amount, refunded_amount',
      )
      .eq('business_id', business_id),
    supabaseClient.from('properties').select('id, name').eq('business_id', business_id),
    supabaseClient.from('expenses').select('id, amount').eq('business_id', business_id),
    supabaseClient
      .from('payment_messages')
      .select('id, message_content')
      .eq('business_id', business_id),
    supabaseClient
      .from('bookings')
      .select('id, name, status, deleted, converted_tenant_id')
      .eq('business_id', business_id),
    supabaseClient
      .from('maintenance_requests')
      .select('id, status, event_date, house_id')
      .eq('business_id', business_id),
    supabaseClient
      .from('promotions')
      .select('id, valid_from, valid_until, scope, tenant_id')
      .eq('business_id', business_id),
  ]);

  if (
    !tenants ||
    !houses ||
    !contracts ||
    !receipts ||
    !properties ||
    !expenses ||
    !paymentMessages ||
    !bookings ||
    !maintenanceReqs ||
    !promotionList
  ) {
    throw new Error(`Failed to fetch data for business ${business_id}`);
  }

  const dbData: DBData = {
    tenants,
    houses,
    contracts,
    receipts,
    properties,
    expenses,
    paymentMessages,
    bookings,
    maintenanceReqs,
    promotionList,
  };

  // 2. Initialize Anomaly Store
  const anomalies: AnomaliesList = {
    tenantsWithoutContracts: [],
    paidTenantsWithoutStatus: [],
    houseStatusMismatches: [],
    overlappingContracts: [],
    invalidContractDates: [],
    missingMaintDates: [],
    invalidPromoDates: [],
    duplicateHouses: [],
    formerFutureContracts: [],
    unconvertedBookings: [],
    orphanedHouses: [],
    orphanedReceipts: [],
    brokenMaintenance: [],
    brokenContracts: [],
    orphanedPromos: [],
    orphanedBookings: [],
    duplicateDetection: [],
    receiptDateMismatches: [],
    invalidRent: [],
    invalidReceipts: [],
    invalidExpenses: [],
    overRefundedReceipts: [],
    duplicateTenants: [],
    missingHouseNumbers: [],
    uncontactableTenants: [],
    emptyProperties: [],
  };
  const fixes: Fix[] = [];

  // 3. Run Checkers
  await checkStatusAnomalies(dbData, anomalies, fixes, action, supabaseClient);
  await checkLogicalAnomalies(dbData, anomalies, fixes, action, supabaseClient);
  await checkRelationshipAnomalies(dbData, anomalies, fixes, action, supabaseClient);
  await checkFinancialAnomalies(dbData, anomalies, fixes, action, supabaseClient);
  checkQualityAnomalies(dbData, anomalies);

  // 4. Send Email Report
  try {
    const { data: business } = await supabaseClient
      .from('businesses')
      .select('name, email')
      .eq('id', business_id)
      .single();
    if (business?.email) {
      const emailContent = buildIntegrityEmail(
        business.name || 'Admin',
        anomalies,
        fixes,
        action,
      );

      try {
        const mailClient = createEmailClient();
        const msg = formatEmailData({
          to: business.email,
          subject: 'Database Integrity Report',
          html: emailContent,
        });
        await mailClient.send(msg);
        await mailClient.close();
      } catch (emailError) {
        console.error(
          'Failed to send integrity report email via denomailer:',
          emailError,
        );
      }
    }
  } catch (err) {
    console.error('Error preparing integrity report email:', err);
  }

  const anomaliesCount = Object.values(anomalies).reduce(
    (acc, curr) => acc + curr.length,
    0,
  );
  return { anomaliesCount, fixesCount: fixes.length, anomalies, fixes };
}

serve(async (req: Request) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  try {
    const supabaseClient = getServiceRoleClient();
    const ctx = await getClientContext(req);
    if (ctx.error && !ctx.isInternal) return errorResponse(ctx.error, 401);

    const isCron = ctx.isInternal;
    const body = await req.json().catch(() => ({}));
    const action = body.action || 'analyze'; // "analyze" or "fix"

    if (isCron && req.method === 'GET') {
      const { data: businesses } = await supabaseClient
        .from('businesses')
        .select('id, name');
      const results = [];
      for (const biz of businesses || []) {
        try {
          const res = await processBusinessIntegrity(supabaseClient, biz.id, 'analyze');
          results.push({ business_id: biz.id, ...res });
        } catch (e) {
          results.push({ business_id: biz.id, error: e.message });
        }
      }
      return successResponse({ success: true, message: 'Cron completed', results });
    }

    if (!isCron) {
      const { business_id } = body;
      if (!business_id) return errorResponse('Missing business_id', 400);

      const { data: bData } = await supabaseClient
        .from('businesses')
        .select('user_id')
        .eq('id', business_id)
        .single();
      if (!bData || bData.user_id !== ctx.user?.id) {
        return errorResponse('Forbidden', 403);
      }

      const res = await processBusinessIntegrity(supabaseClient, business_id, action);
      return successResponse({ success: true, ...res });
    }

    return errorResponse('Invalid request', 400);
  } catch (error) {
    return errorResponse(error.message, 500);
  }
});
