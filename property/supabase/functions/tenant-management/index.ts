// @ts-nocheck
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import {
  createholidayRequestEmail,
  createInfoRequestEmail,
  createTenantAcknowledgementEmail,
  createTenantholidayUpdatedEmail,
  createTenantInfoUpdatedEmail,
} from '../_shared/email-templates.ts';
import {
  errorResponse,
  getClientContext,
  getInternalHeaders,
  getServiceRoleClient,
  handleCors,
  isPlaceholderEmail,
  successResponse,
} from '../_shared/index.ts';

async function notifyBusiness(supabase, business_id, tenant_id, subject, html) {
  const { data: business } = await supabase
    .from('businesses')
    .select('name, email')
    .eq('id', business_id)
    .single();

  if (business?.email) {
    const { data: tenant } = await supabase
      .from('tenants')
      .select('name')
      .eq('id', tenant_id)
      .single();

    if (tenant) {
      await supabase.functions.invoke('send-message', {
        body: { channel: 'email', to: business.email, subject, html },
        headers: getInternalHeaders(),
      });
    }
  }
}

serve(async req => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  try {
    let supabase;
    const url = new URL(req.url);
    const path = url.pathname;

    // Background Scanning Mode (Triggered by CRON or Manual /scan)
    if (req.method === 'POST' && path.includes('/scan/')) {
      const ctx = await getClientContext(req);
      if (ctx.error) return errorResponse(ctx.error, 401);
      supabase = ctx.supabase;

      const body = await req.json().catch(() => ({}));

      if (path.endsWith('/scan/request-info')) {
        return await triggerInfoRequests(supabase, body.tenant_id, body.skip_email);
      } else if (path.endsWith('/scan/mark-holiday')) {
        return await triggerholidayRequests(supabase, body.tenant_id, body.skip_email);
      } else {
        return errorResponse('Scan target not found', 404);
      }
    }

    // GET Mode: Token Validation (Publicly accessible via token)
    if (req.method === 'GET') {
      supabase = getServiceRoleClient();
      const token = url.searchParams.get('token');

      if (!token) {
        return errorResponse('Missing token', 400);
      }

      const isRequestInfo = path.endsWith('/request-info');
      const isMarkHoliday = path.endsWith('/mark-holiday');
      const tokenType = isRequestInfo
        ? 'info_request'
        : isMarkHoliday
          ? 'holiday_request'
          : null;

      if (!tokenType) {
        return errorResponse('Not Found', 404);
      }

      // Validate token
      const { data: tokenData, error: tokenError } = await supabase
        .from('tokens')
        .select('metadata, business_id')
        .eq('token', token)
        .eq('type', tokenType)
        .single();

      if (tokenError || !tokenData) {
        return errorResponse('Invalid link. Token not found.', 403);
      }

      const rawMetadata = tokenData.metadata || {};
      const expiresAtVal = rawMetadata.expires_at || (tokenData as any).expires_at;
      const usedAtVal = rawMetadata.used_at || (tokenData as any).used_at;

      const now = new Date();
      const expiresAt = expiresAtVal ? new Date(expiresAtVal) : null;

      if (expiresAt && now > expiresAt) {
        return errorResponse('Link has expired.', 403);
      }

      if (usedAtVal) {
        return errorResponse('This link has already been used.', 403);
      }

      const tenantId = rawMetadata.tenant_id || (tokenData as any).tenant_id;
      const businessId = tokenData.business_id;

      // Fetch Business Name & Tenant Details
      const [{ data: business }, { data: tenant }] = await Promise.all([
        supabase.from('businesses').select('name').eq('id', businessId).single(),
        supabase
          .from('tenants')
          .select('name, email, phone, next_of_kin')
          .eq('id', tenantId)
          .single(),
      ]);

      const responsePayload = {
        business_name: business?.name,
        tenant_name: tenant?.name,
        tenant_id: tenantId,
        business_id: businessId,
        email: tenant?.email && !isPlaceholderEmail(tenant.email) ? tenant.email : '',
        phone: tenant?.phone || '',
        next_of_kin: tenant?.next_of_kin || null,
      };

      if (isRequestInfo) {
        const missing_fields = [];
        if (!tenant?.email || isPlaceholderEmail(tenant.email))
          missing_fields.push('email');
        if (!tenant?.phone || tenant.phone.trim() === '') missing_fields.push('phone');

        let hasNextOfKin = false;
        if (tenant?.next_of_kin) {
          try {
            const nok =
              typeof tenant.next_of_kin === 'string'
                ? JSON.parse(tenant.next_of_kin)
                : tenant.next_of_kin;
            if (Array.isArray(nok) && nok.length > 0) hasNextOfKin = true;
          } catch (_e) {}
        }
        if (!hasNextOfKin) missing_fields.push('next_of_kin');

        responsePayload.missing_fields = missing_fields;
      }

      return successResponse(responsePayload);
    }

    // POST Mode: Submit Info (Authorized by token)
    if (req.method === 'POST') {
      supabase = getServiceRoleClient();
      const isRequestInfo = path.endsWith('/request-info');
      const isMarkHoliday = path.endsWith('/mark-holiday');
      const tokenType = isRequestInfo
        ? 'info_request'
        : isMarkHoliday
          ? 'holiday_request'
          : null;

      if (!tokenType) {
        return errorResponse('Not Found', 404);
      }

      const body = await req.json().catch(() => ({}));
      const { tenant_id, business_id, token } = body;

      if (!tenant_id || !business_id || !token) {
        return errorResponse('Missing required tenant, business ID, or token', 400);
      }

      // Mark token as used
      const { data: existingToken } = await supabase
        .from('tokens')
        .select('metadata')
        .eq('token', token)
        .eq('type', tokenType)
        .single();

      if (existingToken) {
        const updatedMeta = {
          ...(existingToken.metadata || {}),
          used_at: new Date().toISOString(),
        };

        await supabase
          .from('tokens')
          .update({
            metadata: updatedMeta,
            updated_at: new Date().toISOString(),
          })
          .eq('token', token)
          .eq('type', tokenType);
      }

      if (isRequestInfo) {
        const { email, phone, next_of_kin } = body;

        // Update tenant info
        const updateData: any = {};
        if (email) updateData.email = email;
        if (phone) updateData.phone = phone;
        if (next_of_kin) updateData.next_of_kin = next_of_kin;

        if (Object.keys(updateData).length > 0) {
          const { error: updateError } = await supabase
            .from('tenants')
            .update(updateData)
            .eq('id', tenant_id);

          if (updateError) throw updateError;
        }

        // Notify Business and Tenant
        const [{ data: tenant }, { data: business }] = await Promise.all([
          supabase.from('tenants').select('name, email').eq('id', tenant_id).single(),
          supabase.from('businesses').select('name').eq('id', business_id).single(),
        ]);

        if (tenant) {
          const html = createTenantInfoUpdatedEmail({
            tenantName: tenant.name,
            email: email,
            phone: phone,
            next_of_kin: next_of_kin,
          });
          await notifyBusiness(
            supabase,
            business_id,
            tenant_id,
            `Information Updated: ${tenant.name}`,
            html,
          );

          const tenantEmail = email || tenant.email;
          if (tenantEmail && !isPlaceholderEmail(tenantEmail)) {
            const ackHtml = createTenantAcknowledgementEmail({
              tenantName: tenant.name,
              businessName: business?.name || 'Property Manager',
              email: email,
              phone: phone,
              next_of_kin: next_of_kin,
            });
            await supabase.functions.invoke('send-message', {
              body: {
                channel: 'email',
                to: tenantEmail,
                subject: 'Contact Information Updated',
                html: ackHtml,
              },
              headers: getInternalHeaders(),
            });
          }
        }
      } else if (isMarkHoliday) {
        const {
          moveout_date,
          return_date,
          door_open,
          belongings_cleared,
          key_handed_over,
          is_moving_out,
          is_staying,
        } = body;

        if (!moveout_date && !is_staying) {
          return errorResponse('Missing required information', 400);
        }

        // Fetch Active Contracts
        const { data: activeContracts } = await supabase
          .from('contracts')
          .select('id, metadata')
          .eq('tenant_id', tenant_id)
          .is('deleted', false)
          .eq('status', 'active');

        if (is_moving_out) {
          const { error: updateError } = await supabase
            .from('contracts')
            .update({ end_date: moveout_date, status: 'terminated' })
            .eq('tenant_id', tenant_id)
            .is('deleted', false)
            .eq('status', 'active');

          if (updateError) throw updateError;

          const { error: tenantUpdateError } = await supabase
            .from('tenants')
            .update({ status: 'former' })
            .eq('id', tenant_id);

          if (tenantUpdateError) throw tenantUpdateError;
        } else if (activeContracts && activeContracts.length > 0) {
          const updates = activeContracts.map(contract => {
            const currentMetadata = contract.metadata || {};
            let newMetadata;

            if (is_staying) {
              newMetadata = { ...currentMetadata, holiday_status: 'staying' };
            } else {
              const breaks = currentMetadata.breaks || [];
              breaks.push({
                id: crypto.randomUUID(),
                reason: 'Contract Paused',
                end_date: return_date,
                created_at: new Date().toISOString(),
                is_partial: true,
                start_date: moveout_date,
              });
              newMetadata = { ...currentMetadata, breaks };
            }

            return supabase
              .from('contracts')
              .update({ metadata: newMetadata })
              .eq('id', contract.id);
          });

          await Promise.all(updates);
        }

        // Notify Business
        const { data: tenant } = await supabase
          .from('tenants')
          .select('name')
          .eq('id', tenant_id)
          .single();
        if (tenant) {
          const subject = is_moving_out
            ? `Move Out Recorded: ${tenant.name}`
            : is_staying
              ? `Tenant Staying: ${tenant.name}`
              : `Holiday Recorded: ${tenant.name}`;

          const html = createTenantholidayUpdatedEmail({
            tenantName: tenant.name,
            moveoutDate: moveout_date,
            returnDate: return_date,
            doorOpen: door_open || false,
            belongingsCleared: belongings_cleared || false,
            keyHandedOver: key_handed_over || false,
            isMovingOut: is_moving_out || false,
            isStaying: is_staying || false,
          });

          await notifyBusiness(supabase, business_id, tenant_id, subject, html);
        }
      }

      return successResponse({ success: true });
    }

    return errorResponse('Not Found', 404);
  } catch (error) {
    return errorResponse(error.message, 500);
  }
});

async function triggerInfoRequests(supabase: any, tenant_id?: string, skipEmail = false) {
  try {
    let tenantsToTrigger = [];

    if (tenant_id) {
      // Single Tenant Mode
      const { data: tenant, error: tError } = await supabase
        .from('tenants')
        .select('name, email, phone, next_of_kin, business_id, businesses(name)')
        .eq('id', tenant_id)
        .single();

      if (tError) throw tError;

      const missingFields = [];
      if (!tenant.email || isPlaceholderEmail(tenant.email)) missingFields.push('Email');
      if (!tenant.phone) missingFields.push('Phone Number');

      let hasNextOfKin = false;
      if (tenant.next_of_kin) {
        try {
          const nok =
            typeof tenant.next_of_kin === 'string'
              ? JSON.parse(tenant.next_of_kin)
              : tenant.next_of_kin;
          if (Array.isArray(nok) && nok.length > 0) hasNextOfKin = true;
        } catch (_e) {}
      }
      if (!hasNextOfKin) missingFields.push('Next of Kin');

      tenantsToTrigger = [
        {
          tenant_id: tenant_id,
          tenant_name: tenant.name,
          tenant_email: tenant.email,
          business_name: tenant.businesses?.name || 'Your Property Manager',
          missing_fields: missingFields,
        },
      ];
    } else {
      // Full Scan Mode
      const { data, error } = await supabase.rpc('find_tenants_with_missing_info');
      if (error) throw error;
      tenantsToTrigger = data || [];
    }

    const results = [];
    const appUrl = Deno.env.get('APP_URL') || 'https://booking.ogsadmin.com';

    for (const tenant of tenantsToTrigger) {
      try {
        const { data: infoToken, error: tokenError } = await supabase.rpc(
          'create_info_request_token',
          { p_tenant_id: tenant.tenant_id, p_expires_hours: 168 },
        );

        if (tokenError) {
          console.error(
            `Error creating info request token for tenant ${tenant.tenant_id}:`,
            tokenError,
          );
          results.push({
            tenant_id: tenant.tenant_id,
            status: 'error',
            error: `Token generation failed: ${tokenError.message}`,
          });
          continue;
        }

        const requestUrl = `${appUrl}/request-info?token=${infoToken}`;
        let emailError = null;

        if (!skipEmail && tenant.tenant_email) {
          const { error } = await supabase.functions.invoke('send-message', {
            body: {
              channel: 'email',
              to: tenant.tenant_email,
              subject: `Update Your Information - ${tenant.business_name}`,
              html: createInfoRequestEmail({
                tenantName: tenant.tenant_name,
                businessName: tenant.business_name,
                missingFields: tenant.missing_fields,
                requestUrl: requestUrl,
              }),
            },
            headers: getInternalHeaders(),
          });
          emailError = error;
        }

        results.push({
          tenant_id: tenant.tenant_id,
          status: skipEmail ? 'generated' : emailError ? 'error' : 'sent',
          url: requestUrl,
          error: emailError?.message,
        });
      } catch (err) {
        results.push({
          tenant_id: tenant.tenant_id,
          status: 'error',
          error: err.message,
        });
      }
    }

    return successResponse({ success: true, results });
  } catch (error) {
    return errorResponse(error.message, 500);
  }
}

async function triggerholidayRequests(
  supabase: any,
  tenant_id?: string,
  skipEmail = false,
) {
  try {
    let tenantsToTrigger = [];

    if (tenant_id) {
      const { data: tenant, error: tError } = await supabase
        .from('tenants')
        .select('name, email, business_id, businesses(name)')
        .eq('id', tenant_id)
        .single();

      if (tError) throw tError;

      tenantsToTrigger = [
        {
          tenant_id: tenant_id,
          tenant_name: tenant.name,
          tenant_email: tenant.email,
          business_id: tenant.business_id,
          business_name: tenant.businesses?.name || 'Your Property Manager',
        },
      ];
    } else {
      return errorResponse('Batch not supported yet', 400);
    }

    const results = [];
    const appUrl = Deno.env.get('APP_URL') || 'https://booking.ogsadmin.com';

    for (const tenant of tenantsToTrigger) {
      try {
        const tokenStr = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 168 * 3600 * 1000).toISOString();

        const { error: tokenError } = await supabase.from('tokens').insert({
          token: tokenStr,
          type: 'holiday_request',
          business_id: tenant.business_id,
          metadata: { tenant_id: tenant.tenant_id, expires_at: expiresAt },
        });

        if (tokenError) {
          results.push({
            tenant_id: tenant.tenant_id,
            status: 'error',
            error: `Token generation failed: ${tokenError.message}`,
          });
          continue;
        }

        const requestUrl = `${appUrl}/mark-holiday?token=${tokenStr}`;
        let emailError = null;

        if (!skipEmail && tenant.tenant_email) {
          const { error } = await supabase.functions.invoke('send-message', {
            body: {
              channel: 'email',
              to: tenant.tenant_email,
              subject: `Update Your Holiday Information - ${tenant.business_name}`,
              html: createholidayRequestEmail({
                tenantName: tenant.tenant_name,
                businessName: tenant.business_name,
                requestUrl: requestUrl,
              }),
            },
            headers: getInternalHeaders(),
          });
          emailError = error;
        }

        results.push({
          tenant_id: tenant.tenant_id,
          status: skipEmail ? 'generated' : emailError ? 'error' : 'sent',
          url: requestUrl,
          error: emailError?.message,
        });
      } catch (err) {
        results.push({
          tenant_id: tenant.tenant_id,
          status: 'error',
          error: err.message,
        });
      }
    }

    return successResponse({ success: true, results });
  } catch (error) {
    return errorResponse(error.message, 500);
  }
}
