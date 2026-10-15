// @ts-nocheck
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import {
  createContractExpiryEmail,
  createContractTerminationEmail,
  createExpirationReminderEmail,
  generateContractExpirySubject,
} from '../_shared/email-templates.ts';
import {
  errorResponse,
  getClientContext,
  getInternalHeaders,
  getServiceRoleClient,
  handleCors,
  successResponse,
} from '../_shared/index.ts';

serve(async req => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  try {
    let supabase;
    const url = new URL(req.url);

    // GET Mode: Token Validation (Publicly accessible via token)
    if (req.method === 'GET') {
      supabase = getServiceRoleClient();
      const token = url.searchParams.get('token');
      if (!token) {
        return errorResponse('Token is required', 400);
      }

      const { data: validation, error } = await supabase.rpc('validate_renewal_token', {
        p_token: token,
      });

      if (error) {
        console.error('Error validating token:', error);
        return errorResponse(error.message, 500);
      }

      const result = validation?.[0];
      return successResponse({
        is_valid: result?.is_valid || false,
        contract_id: result?.contract_id || null,
        tenant_id: result?.tenant_id || null,
        end_date: result?.end_date || null,
        rent_amount: result?.rent_amount || null,
        tenant_name: result?.tenant_name || null,
        property_name: result?.property_name || null,
        house_number: result?.house_number || null,
      });
    }

    // POST Mode: Actions via payload
    if (req.method === 'POST') {
      const ctx = await getClientContext(req);
      if (ctx.error) return errorResponse(ctx.error, 401);
      supabase = ctx.supabase;

      const body = await req.json().catch(() => ({}));
      const action = body.action;

      if (!action) {
        return errorResponse('Missing action in payload', 400);
      }

      switch (action) {
        case 'scan':
          return await handleScan(supabase);
        case 'renew':
          return await handleRenew(supabase, body.contract_id);
        case 'terminate':
          return await handleTerminate(supabase, body);
        default:
          return errorResponse('Invalid action', 400);
      }
    }

    return errorResponse('Method not allowed', 405);
  } catch (error) {
    console.error('Error in contract-management function:', error);
    return errorResponse(error.message, 500);
  }
});

// === SCAN & NOTIFICATIONS ===
async function handleScan(supabase: any) {
  try {
    const { data: expiringContracts, error: contractsError } = await supabase.rpc(
      'find_expiring_contracts',
      {
        p_days_before_expiry: 30, // Default to 30 days
      },
    );

    if (contractsError) {
      console.error('Error fetching expiring contracts:', contractsError);
      throw contractsError;
    }

    console.log(`Found ${expiringContracts?.length || 0} expiring contracts`);

    const results = {
      total: expiringContracts?.length || 0,
      sent: 0,
      failed: 0,
      errors: [],
    };

    const internalHeaders = getInternalHeaders();

    for (const contract of expiringContracts || []) {
      try {
        const { data: contractData, error: contractError } = await supabase
          .from('contracts')
          .select('business_id, status')
          .eq('id', contract.contract_id)
          .single();

        if (
          !contractError &&
          contractData?.status &&
          !['active', 'expiring_soon'].includes(contractData.status)
        ) {
          await supabase
            .from('contracts')
            .update({ status: 'active' })
            .eq('id', contract.contract_id);
        }

        let businessData = null;
        if (!contractError && contractData?.business_id) {
          const { data: business, error: businessError } = await supabase
            .from('businesses')
            .select('*')
            .eq('id', contractData.business_id)
            .single();

          if (!businessError && business) {
            businessData = business;
          }
        }

        // Send expiry notification email
        const emailData = {
          channel: 'email',
          to: contract.tenant_email,
          subject: generateContractExpirySubject(contract, businessData),
          html: createContractExpiryEmail(contract, businessData),
        };

        const { error: expiryEmailError } = await supabase.functions.invoke(
          'send-message',
          {
            body: emailData,
            headers: internalHeaders,
          },
        );

        if (expiryEmailError) {
          await supabase.rpc('log_contract_notification', {
            p_contract_id: contract.contract_id,
            p_business_id: contract.business_id,
            p_notification_type: 'expiry',
            p_recipient_email: contract.tenant_email,
            p_days_until_expiry: contract.days_until_expiry,
            p_status: 'failed',
            p_error_message: expiryEmailError.message,
          });
        } else {
          await supabase.rpc('log_contract_notification', {
            p_contract_id: contract.contract_id,
            p_business_id: contract.business_id,
            p_notification_type: 'expiry',
            p_recipient_email: contract.tenant_email,
            p_days_until_expiry: contract.days_until_expiry,
            p_status: 'sent',
          });
        }

        // Send renewal email
        const { data: tokenData, error: tokenError } = await supabase.rpc(
          'create_contract_renewal_token',
          {
            p_contract_id: contract.contract_id,
            p_expires_hours: 168, // 7 days
          },
        );

        if (tokenError) {
          results.failed++;
          results.errors.push(`Contract ${contract.contract_id}: Token failed`);
          continue;
        }

        const renewalToken = Array.isArray(tokenData)
          ? tokenData[0]?.renewal_token
          : tokenData?.renewal_token;
        const appUrl = Deno.env.get('APP_URL') || 'https://booking.ogsadmin.com';
        const renewalUrl = `${appUrl}/renew-contract?token=${renewalToken}`;

        const { error: emailError } = await supabase.functions.invoke('send-message', {
          body: {
            channel: 'email',
            to: contract.tenant_email,
            subject: `🔄 Contract Renewal Invitation - ${contract.property_name}`,
            html: createExpirationReminderEmail({
              tenantName: contract.tenant_name,
              propertyName: contract.property_name,
              houseNumber: contract.house_number,
              endDate: contract.end_date,
              daysUntilExpiry: contract.days_until_expiry,
              rentAmount: contract.rent_amount,
              renewalUrl: renewalUrl,
              business: businessData,
            }),
          },
          headers: internalHeaders,
        });

        if (emailError) {
          results.failed++;
          await supabase.rpc('log_contract_notification', {
            p_contract_id: contract.contract_id,
            p_business_id: contract.business_id,
            p_notification_type: 'renewal',
            p_recipient_email: contract.tenant_email,
            p_days_until_expiry: contract.days_until_expiry,
            p_status: 'failed',
            p_error_message: emailError.message,
          });
          continue;
        }

        await supabase
          .from('contracts')
          .update({
            renewal_reminder_sent_at: new Date().toISOString(),
            status: 'expiring_soon',
          })
          .eq('id', contract.contract_id);

        await supabase.rpc('log_contract_notification', {
          p_contract_id: contract.contract_id,
          p_business_id: contract.business_id,
          p_notification_type: 'renewal',
          p_recipient_email: contract.tenant_email,
          p_days_until_expiry: contract.days_until_expiry,
          p_status: 'sent',
        });

        results.sent++;
      } catch (_error) {
        results.failed++;
      }
    }

    return successResponse({
      success: true,
      message: `Processed ${results.total} contracts: ${results.sent} sent`,
      ...results,
    });
  } catch (error) {
    console.error('Error in handleScan:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
}

// === SINGLE RENEWAL ===
async function handleRenew(supabase: any, contractId: string) {
  try {
    const { data: contractData, error: contractError } = await supabase
      .from('contracts')
      .select(
        `
        id,
        end_date,
        rent_amount,
        business_id,
        status,
        tenant:tenants(name, email),
        house:houses(
          house_number,
          property:properties(name)
        )
      `,
      )
      .eq('id', contractId)
      .single();

    if (contractError || !contractData) {
      throw new Error(`Contract not found: ${contractError?.message || 'Unknown error'}`);
    }

    const tenantEmail = contractData.tenant?.email;
    if (!tenantEmail) {
      throw new Error('Tenant email not found for this contract');
    }

    const today = new Date();
    const endDate = new Date(contractData.end_date);
    const daysUntilExpiry = Math.ceil(
      (endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (
      contractData.status &&
      !['active', 'expiring_soon'].includes(contractData.status)
    ) {
      await supabase.from('contracts').update({ status: 'active' }).eq('id', contractId);
    }

    let businessData = null;
    if (contractData.business_id) {
      const { data: business, error: businessError } = await supabase
        .from('businesses')
        .select('name, email, phone')
        .eq('id', contractData.business_id)
        .single();

      if (!businessError && business) {
        businessData = business;
      }
    }

    const { data: tokenData, error: tokenError } = await supabase.rpc(
      'create_contract_renewal_token',
      {
        p_contract_id: contractId,
        p_expires_hours: 168, // 7 days
      },
    );

    if (tokenError) {
      throw new Error(`Failed to create renewal token: ${tokenError.message}`);
    }

    const renewalToken =
      typeof tokenData === 'string'
        ? tokenData
        : tokenData?.[0]?.renewal_token || tokenData?.renewal_token;
    if (!renewalToken) {
      throw new Error('Failed to generate renewal token');
    }

    const appUrl = Deno.env.get('APP_URL') || 'https://booking.ogsadmin.com';
    const renewalUrl = `${appUrl}/renew-contract?token=${renewalToken}`;

    const propertyName = contractData.house?.property?.name || 'N/A';
    const houseNumber = contractData.house?.house_number || 'N/A';
    const tenantName = contractData.tenant?.name || 'Tenant';
    const rentAmount = contractData.rent_amount || 0;

    const internalHeaders = getInternalHeaders();

    const { error: emailError } = await supabase.functions.invoke('send-message', {
      body: {
        channel: 'email',
        to: tenantEmail,
        subject: `Contract Expiration Reminder - ${propertyName}`,
        html: createExpirationReminderEmail({
          tenantName,
          propertyName,
          houseNumber,
          endDate: contractData.end_date,
          daysUntilExpiry,
          rentAmount,
          renewalUrl,
          business: businessData,
        }),
      },
      headers: internalHeaders,
    });

    if (emailError) {
      throw new Error(`Failed to send email: ${emailError.message}`);
    }

    await supabase
      .from('contracts')
      .update({
        renewal_reminder_sent_at: new Date().toISOString(),
        status: 'expiring_soon',
      })
      .eq('id', contractId);

    return successResponse({
      success: true,
      message: `Reminder sent to ${tenantName}`,
      contract_id: contractId,
      tenant_email: tenantEmail,
    });
  } catch (error) {
    console.error('Error in handleRenew:', error);
    return errorResponse(error.message, 500);
  }
}

// === SINGLE TERMINATION (Merged from contract-termination) ===
async function handleTerminate(supabase: any, body: any) {
  try {
    const { contract_id, termination_date, pdf_attachment_base64, contract_pdf_base64 } =
      body;

    if (!contract_id || !termination_date) {
      return errorResponse('contract_id and termination_date are required', 400);
    }

    const { data: contractData, error: contractError } = await supabase
      .from('contracts')
      .select(`
        id,
        business_id,
        tenant:tenants(name, email),
        house:houses(
          house_number,
          property:properties(name)
        )
      `)
      .eq('id', contract_id)
      .single();

    if (contractError || !contractData) {
      throw new Error(`Contract not found: ${contractError?.message || 'Unknown error'}`);
    }

    const tenantEmail = contractData.tenant?.email;
    if (!tenantEmail) {
      throw new Error('Tenant email not found for this contract');
    }

    let businessData = null;
    if (contractData.business_id) {
      const { data: business, error: businessError } = await supabase
        .from('businesses')
        .select('name, email, phone')
        .eq('id', contractData.business_id)
        .single();

      if (!businessError && business) {
        businessData = business;
      }
    }

    const propertyName = contractData.house?.property?.name || 'N/A';
    const houseNumber = contractData.house?.house_number || 'N/A';
    const tenantName = contractData.tenant?.name || 'Tenant';

    const internalHeaders = getInternalHeaders();

    const emailHtml = createContractTerminationEmail({
      tenantName,
      propertyName,
      houseNumber,
      terminationDate: termination_date,
      business: businessData,
    });

    const emailData: any = {
      channel: 'email',
      to: tenantEmail,
      subject: `Notice of Contract Termination - ${businessData?.name || 'Property Management'}`,
      html: emailHtml,
    };

    if (pdf_attachment_base64 || contract_pdf_base64) {
      emailData.attachments = [];
      if (pdf_attachment_base64) {
        emailData.attachments.push({
          filename: 'Termination_Notice.pdf',
          content: pdf_attachment_base64,
          encoding: 'base64',
        });
      }
      if (contract_pdf_base64) {
        emailData.attachments.push({
          filename: 'Original_Lease_Agreement.pdf',
          content: contract_pdf_base64,
          encoding: 'base64',
        });
      }
    }

    const { error: emailError } = await supabase.functions.invoke('send-message', {
      body: emailData,
      headers: internalHeaders,
    });

    if (emailError) {
      throw new Error(`Failed to send email: ${emailError.message}`);
    }

    return successResponse({
      message: 'Termination notice sent successfully',
      success: true,
    });
  } catch (error) {
    console.error('Error in handleTerminate:', error);
    return errorResponse(error.message, 500);
  }
}
