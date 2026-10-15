// @ts-nocheck
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

import {
  errorResponse,
  getClientContext,
  getServiceRoleClient,
  handleCors,
  successResponse,
} from '../_shared/index.ts';

serve(async (req: Request) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  try {
    // We use the service role client so that we can bypass RLS for cleanup and update
    const supabase = getServiceRoleClient();

    const ctx = await getClientContext(req);
    if (ctx.error && !ctx.isInternal) return errorResponse(ctx.error, 401);

    // Check if the caller is an admin / cron using the service key
    const isServiceRole = ctx.isInternal;

    // Parse URL query params
    const url = new URL(req.url);
    const action = url.searchParams.get('action');

    // Handle Admin/Cron Cleanup trigger
    if (
      isServiceRole &&
      (req.method === 'DELETE' || req.method === 'GET' || action === 'cleanup')
    ) {
      console.log('[Delete User Data] Running scheduled cleanup job...');
      const now = new Date().toISOString();

      // 1. Fetch tenants scheduled for deletion
      const { data: tenants, error: tenantsErr } = await supabase
        .from('tenants')
        .select('id, user_id, email, name, metadata')
        .neq('deleted', true);

      if (tenantsErr) {
        throw new Error(`Failed to fetch tenants: ${tenantsErr.message}`);
      }

      const tenantsToDelete = tenants.filter(t => {
        const scheduled = t.metadata?.scheduled_deletion_at;
        return scheduled && new Date(scheduled) <= new Date(now);
      });

      console.log(
        `[Delete User Data] Found ${tenantsToDelete.length} tenants scheduled for deletion.`,
      );

      let deletedTenantsCount = 0;
      let deletedBookingsCount = 0;

      for (const tenant of tenantsToDelete) {
        console.log(`[Delete User Data] Deleting tenant ${tenant.id}`);

        try {
          // A. Delete transactions associated with tenant
          const { error: txErr } = await supabase
            .from('transactions')
            .delete()
            .eq('tenant_id', tenant.id);
          if (txErr)
            console.warn(
              `[Delete User Data] Error deleting transactions for tenant ${tenant.id}:`,
              txErr.message,
            );

          // B. Get contracts to delete payments and payment_message_receipts
          const { data: contracts, error: contractsFetchErr } = await supabase
            .from('contracts')
            .select('id')
            .eq('tenant_id', tenant.id);

          if (!contractsFetchErr && contracts && contracts.length > 0) {
            const contractIds = contracts.map(c => c.id);

            // Fetch receipts for these contracts
            const { data: receipts, error: receiptsFetchErr } = await supabase
              .from('receipts')
              .select('id')
              .in('contract_id', contractIds);

            if (!receiptsFetchErr && receipts && receipts.length > 0) {
              const receiptIds = receipts.map(r => r.id);

              // Delete payment_message_receipts
              const { error: pmrErr } = await supabase
                .from('payment_message_receipts')
                .delete()
                .in('receipt_id', receiptIds);
              if (pmrErr)
                console.warn(
                  `[Delete User Data] Error deleting payment message receipts:`,
                  pmrErr.message,
                );

              // Delete receipts
              const { error: receiptsErr } = await supabase
                .from('receipts')
                .delete()
                .in('contract_id', contractIds);
              if (receiptsErr)
                console.warn(
                  `[Delete User Data] Error deleting receipts:`,
                  receiptsErr.message,
                );
            }

            // Delete contracts
            const { error: contractsErr } = await supabase
              .from('contracts')
              .delete()
              .eq('tenant_id', tenant.id);
            if (contractsErr)
              console.warn(
                `[Delete User Data] Error deleting contracts:`,
                contractsErr.message,
              );
          }

          // C. Delete receipts directly belonging to tenant (if any)
          const { error: directReceiptsErr } = await supabase
            .from('receipts')
            .delete()
            .eq('tenant_id', tenant.id);
          if (directReceiptsErr)
            console.warn(
              `[Delete User Data] Error deleting direct receipts:`,
              directReceiptsErr.message,
            );

          // D. Delete bookings belonging to tenant's email or user_id
          const orFilter = [];
          if (tenant.email) orFilter.push(`email.eq.${tenant.email}`);
          if (tenant.user_id) orFilter.push(`user_id.eq.${tenant.user_id}`);

          if (orFilter.length > 0) {
            const { error: bookingErr } = await supabase
              .from('bookings')
              .delete()
              .or(orFilter.join(','));
            if (bookingErr)
              console.warn(
                `[Delete User Data] Error deleting bookings:`,
                bookingErr.message,
              );
          }

          // E. Delete the tenant itself
          const { error: tenantDeleteErr } = await supabase
            .from('tenants')
            .delete()
            .eq('id', tenant.id);
          if (tenantDeleteErr) throw tenantDeleteErr;

          // F. Delete Auth User from supabase auth
          if (tenant.user_id) {
            const { error: authDeleteErr } = await supabase.auth.admin.deleteUser(
              tenant.user_id,
            );
            if (authDeleteErr)
              console.warn(
                `[Delete User Data] Error deleting auth user ${tenant.user_id}:`,
                authDeleteErr.message,
              );
          }

          deletedTenantsCount++;
        } catch (tenantErr) {
          console.error(
            `[Delete User Data] Failed to fully delete tenant ${tenant.id}:`,
            tenantErr.message,
          );
        }
      }

      // 2. Fetch bookings scheduled for deletion (that might not be tenants yet)
      const { data: bookings, error: bookingsErr } = await supabase
        .from('bookings')
        .select('id, user_id, email, metadata')
        .neq('deleted', true);

      if (bookingsErr) {
        throw new Error(`Failed to fetch bookings: ${bookingsErr.message}`);
      }

      const bookingsToDelete = bookings.filter(b => {
        const scheduled = b.metadata?.scheduled_deletion_at;
        return scheduled && new Date(scheduled) <= new Date(now);
      });

      console.log(
        `[Delete User Data] Found ${bookingsToDelete.length} bookings scheduled for deletion.`,
      );

      for (const booking of bookingsToDelete) {
        console.log(`[Delete User Data] Deleting booking ${booking.id}`);
        try {
          const { error: bookingDeleteErr } = await supabase
            .from('bookings')
            .delete()
            .eq('id', booking.id);
          if (bookingDeleteErr) throw bookingDeleteErr;

          if (booking.user_id) {
            // Check if there is still a tenant with this user_id before deleting auth user
            const { data: existingTenant } = await supabase
              .from('tenants')
              .select('id')
              .eq('user_id', booking.user_id)
              .maybeSingle();

            if (!existingTenant) {
              const { error: authDeleteErr } = await supabase.auth.admin.deleteUser(
                booking.user_id,
              );
              if (authDeleteErr)
                console.warn(
                  `[Delete User Data] Error deleting auth user ${booking.user_id}:`,
                  authDeleteErr.message,
                );
            }
          }

          deletedBookingsCount++;
        } catch (bookingErr) {
          console.error(
            `[Delete User Data] Failed to delete booking ${booking.id}:`,
            bookingErr.message,
          );
        }
      }

      return successResponse({
        success: true,
        message: 'Cleanup complete.',
        deletedTenants: deletedTenantsCount,
        deletedBookings: deletedBookingsCount,
      });
    }

    // Otherwise, we are dealing with a user request (POST)
    // First, verify the user token to get their identity
    const user = ctx.user;
    if (!user) {
      return errorResponse('Invalid session token', 401);
    }

    const requestBody = await req.json().catch(() => ({}));
    const userAction = requestBody.action || 'request'; // "request" or "cancel"

    if (userAction === 'request') {
      console.log(`[Delete User Data] Deletion requested for user ${user.id}`);

      const now = new Date();
      const threeDaysLater = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

      // Update Auth User Metadata
      const { error: authUpdateErr } = await supabase.auth.admin.updateUserById(user.id, {
        user_metadata: {
          ...user.user_metadata,
          deletion_requested_at: now.toISOString(),
          scheduled_deletion_at: threeDaysLater.toISOString(),
        },
      });

      if (authUpdateErr) {
        throw new Error(`Failed to update auth user: ${authUpdateErr.message}`);
      }

      // Update Tenant Metadata
      const { data: tenants, error: fetchTenantsErr } = await supabase
        .from('tenants')
        .select('id, metadata')
        .or(`email.eq.${user.email},user_id.eq.${user.id}`);

      if (!fetchTenantsErr && tenants) {
        for (const t of tenants) {
          await supabase
            .from('tenants')
            .update({
              metadata: {
                ...(t.metadata || {}),
                deletion_requested_at: now.toISOString(),
                scheduled_deletion_at: threeDaysLater.toISOString(),
              },
            })
            .eq('id', t.id);
        }
      }

      // Update Bookings Metadata
      const { data: bookings, error: fetchBookingsErr } = await supabase
        .from('bookings')
        .select('id, metadata')
        .or(`email.eq.${user.email},user_id.eq.${user.id}`);

      if (!fetchBookingsErr && bookings) {
        for (const b of bookings) {
          await supabase
            .from('bookings')
            .update({
              metadata: {
                ...(b.metadata || {}),
                deletion_requested_at: now.toISOString(),
                scheduled_deletion_at: threeDaysLater.toISOString(),
              },
            })
            .eq('id', b.id);
        }
      }

      return successResponse({
        success: true,
        message: 'Data deletion scheduled successfully.',
        deletion_requested_at: now.toISOString(),
        scheduled_deletion_at: threeDaysLater.toISOString(),
      });
    } else if (userAction === 'cancel') {
      console.log(`[Delete User Data] Deletion request cancelled for user ${user.id}`);

      // Clean up Auth User Metadata
      const updatedMetadata = {
        ...user.user_metadata,
        deletion_requested_at: null,
        scheduled_deletion_at: null,
      };

      const { error: authUpdateErr } = await supabase.auth.admin.updateUserById(user.id, {
        user_metadata: updatedMetadata,
      });

      if (authUpdateErr) {
        throw new Error(`Failed to update auth user: ${authUpdateErr.message}`);
      }

      // Clean up Tenant Metadata
      const { data: tenants, error: fetchTenantsErr } = await supabase
        .from('tenants')
        .select('id, metadata')
        .or(`email.eq.${user.email},user_id.eq.${user.id}`);

      if (!fetchTenantsErr && tenants) {
        for (const t of tenants) {
          const m = { ...(t.metadata || {}) };
          delete m.deletion_requested_at;
          delete m.scheduled_deletion_at;

          await supabase.from('tenants').update({ metadata: m }).eq('id', t.id);
        }
      }

      // Clean up Bookings Metadata
      const { data: bookings, error: fetchBookingsErr } = await supabase
        .from('bookings')
        .select('id, metadata')
        .or(`email.eq.${user.email},user_id.eq.${user.id}`);

      if (!fetchBookingsErr && bookings) {
        for (const b of bookings) {
          const m = { ...(b.metadata || {}) };
          delete m.deletion_requested_at;
          delete m.scheduled_deletion_at;

          await supabase.from('bookings').update({ metadata: m }).eq('id', b.id);
        }
      }

      return successResponse({
        success: true,
        message: 'Data deletion request cancelled.',
      });
    } else {
      return errorResponse('Invalid action', 400);
    }
  } catch (error) {
    console.error('[Delete User Data] Server Error:', error.message);
    return errorResponse(error.message, 500);
  }
});
