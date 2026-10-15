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

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }
  try {
    const adminClient = getServiceRoleClient();

    // ── Auth: verify the caller is a real, signed-in user ──────────────────
    const ctx = await getClientContext(req);
    if (ctx.error) return errorResponse(ctx.error, 401);

    const callerUser = ctx.user;

    if (!callerUser) {
      return errorResponse('Invalid or expired session', 401);
    }

    // ── Authorization: caller must own at least one business ───────────────
    console.log('Checking business ownership for caller:', callerUser.id);
    const { data: ownedBusinesses, error: bizError } = await adminClient
      .from('businesses')
      .select('id')
      .eq('user_id', callerUser.id)
      .limit(1);
    console.log('Business ownership result:', ownedBusinesses, bizError);

    if (bizError || !ownedBusinesses || ownedBusinesses.length === 0) {
      return errorResponse('Forbidden: only project owners can manage users', 403);
    }

    // ── Parse request body ─────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const { action, target_user_id } = body;

    // ── ACTION: list ───────────────────────────────────────────────────────
    if (action === 'list') {
      console.log('Handling action: list');
      const { data, error } = await adminClient.auth.admin.listUsers({ perPage: 200 });
      console.log(
        'List users result:',
        data ? `Found ${data.users?.length} users` : 'failed',
        error,
      );
      if (error) throw error;

      // Include the caller in the list
      const users = (data?.users || []).map(u => ({
        id: u.id,
        email: u.email,
        display_name:
          u.user_metadata?.display_name ||
          u.user_metadata?.full_name ||
          u.user_metadata?.name,
        phone: u.user_metadata?.phone,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
        banned_until: u.banned_until,
        is_banned: u.banned_until
          ? u.banned_until === 'none'
            ? false
            : new Date(u.banned_until) > new Date()
          : false,
      }));

      return successResponse({ success: true, users });
    }

    // ── ACTION: ban / unban (require target_user_id) ───────────────────────
    if (action === 'ban' || action === 'unban') {
      if (!target_user_id) {
        return errorResponse('Missing target_user_id', 400);
      }

      // Safety: prevent owner from banning themselves
      if (target_user_id === callerUser.id) {
        return errorResponse('You cannot ban yourself', 400);
      }

      const ban_duration =
        action === 'ban'
          ? '876600h' // ~100 years = effectively permanent
          : 'none'; // lift the ban

      const { data: updatedUser, error: updateError } =
        await adminClient.auth.admin.updateUserById(target_user_id, { ban_duration });

      if (updateError) throw updateError;

      console.log(
        `User ${target_user_id} ${action === 'ban' ? 'banned' : 'unbanned'} by ${callerUser.email}`,
      );

      return successResponse({
        success: true,
        action,
        user_id: target_user_id,
        banned_until: updatedUser?.user?.banned_until ?? null,
      });
    }

    // ── ACTION: update (profile fields) ───────────────────────────────────
    if (action === 'update') {
      if (!target_user_id) {
        return errorResponse('Missing target_user_id', 400);
      }

      const { display_name, email, phone } = body;
      const updatePayload: Record<string, any> = {};

      if (display_name !== undefined) {
        updatePayload.user_metadata = { full_name: display_name };
      }
      if (phone !== undefined) {
        updatePayload.user_metadata = {
          ...(updatePayload.user_metadata ?? {}),
          phone,
        };
      }
      if (email) {
        updatePayload.email = email;
      }

      if (Object.keys(updatePayload).length === 0) {
        return errorResponse('No fields to update', 400);
      }

      const { data: updatedUser, error: updateError } =
        await adminClient.auth.admin.updateUserById(target_user_id, updatePayload);

      if (updateError) throw updateError;

      console.log(`User ${target_user_id} profile updated by ${callerUser.email}`);

      return successResponse({
        success: true,
        action: 'update',
        user_id: target_user_id,
        email: updatedUser?.user?.email,
        user_metadata: updatedUser?.user?.user_metadata,
      });
    }

    // ── Unknown action ─────────────────────────────────────────────────────
    return errorResponse(`Unknown action: "${action}". Use list, ban, or unban.`, 400);
  } catch (err: any) {
    console.error('Unhandled Edge Function Error:', err);
    return errorResponse(err.message || 'Internal Server Error', 500);
  }
});
