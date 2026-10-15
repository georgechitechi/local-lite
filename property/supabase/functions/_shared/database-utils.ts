// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';

/**
 * Delete a specific business by ID using the RPC function
 */
export async function deleteBusinessById(
  supabase: any,
  businessId: string,
  businessName?: string,
): Promise<void> {
  console.log(`🔍 Deleting business: ${businessName || businessId}`);

  const { error: deleteError } = await supabase.rpc('delete_business_data', {
    p_business_id: businessId,
  });

  if (deleteError) {
    console.error(
      `❌ Delete failed for ${businessName || businessId}:`,
      deleteError.message,
    );
    throw new Error(`Failed to delete business: ${deleteError.message}`);
  }

  console.log(`✅ Deleted business: ${businessName || businessId}`);
}

/**
 * Set maintenance mode for a database project
 * Disables/Enables Realtime and ALL Triggers to prevent flooding and overhead
 */
export async function setMaintenanceMode(supabase: any, enabled: boolean): Promise<void> {
  const mode = enabled
    ? 'Enabling Maintenance (Disabling Realtime & Triggers)'
    : 'Disabling Maintenance (Enabling Realtime & Triggers)';
  console.log(`🔧 ${mode}...`);

  try {
    // 1. Set Realtime
    const { error: realtimeError } = await supabase.rpc('set_realtime_enabled', {
      p_enabled: !enabled,
    });
    if (realtimeError) {
      console.warn('⚠️ Realtime RPC failed:', realtimeError.message);
    }

    // 2. Set Triggers
    const { error: triggersError } = await supabase.rpc('set_all_triggers_enabled', {
      p_enabled: !enabled,
    });
    if (triggersError) {
      console.warn('⚠️ Triggers RPC failed:', triggersError.message);
    }

    console.log(`✅ Maintenance mode: ${enabled ? 'ON' : 'OFF'}`);
  } catch (error: any) {
    console.error('❌ Failed to toggle maintenance mode:', error.message);
  }
}

/**
 * Setup progress broadcasting for edge functions
 * Returns user_id and sendProgress function
 *
 * @param req The incoming request with Authorization header
 * @param supabaseClient The Supabase client to use for broadcasting (usually the source or destination client)
 */
export async function setupProgressBroadcasting(req: any, supabaseClient: any) {
  // Get user for progress broadcasting
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') } },
  });

  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();
  const user_id = user?.id;
  const user_email = user?.email;

  // Progress broadcasting helper
  const progressChannel = supabaseClient.channel(`restoration_progress:${user_id}`);
  progressChannel.subscribe();

  let lastBroadcastTime = 0;
  let lastPercentage = -1;

  const sendProgress = async (
    status: string,
    table?: string,
    percentage?: number,
    extra?: any,
  ) => {
    if (!user_id) return;

    const now = Date.now();
    const isCompleted = extra?.completed === true;

    // Throttle: Only send if completed, or status changed, or percentage moved > 1%, or 2 seconds passed
    const shouldBroadcast =
      isCompleted ||
      !percentage ||
      Math.abs((percentage || 0) - lastPercentage) >= 0.01 ||
      now - lastBroadcastTime > 1500;

    if (shouldBroadcast) {
      console.log(
        `📡 Broadcast: ${status} ${percentage ? `(${Math.round(percentage * 100)}%)` : ''}`,
      );

      lastBroadcastTime = now;
      if (percentage !== undefined) lastPercentage = percentage;

      try {
        await progressChannel.send({
          type: 'broadcast',
          event: 'progress',
          payload: {
            status,
            table,
            percentage,
            timestamp: new Date().toISOString(),
            ...(extra || {}),
          },
        });
      } catch (err: any) {
        console.warn('⚠️ Failed to send progress broadcast:', err?.message || err);
      }
    }
  };

  return { user_id, user_email, sendProgress };
}
