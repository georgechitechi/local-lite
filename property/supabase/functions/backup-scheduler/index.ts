// @ts-nocheck
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import {
  errorResponse,
  getClientContext,
  getInternalHeaders,
  handleCors,
  successResponse,
} from '../_shared/index.ts';

serve(async req => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  const startTime = new Date();
  console.log('Backup Scheduler started at:', new Date().toISOString());

  try {
    const ctx = await getClientContext(req);
    if (ctx.error) return errorResponse(ctx.error, 401);
    const supabase = ctx.supabase;
    const isInternal = ctx.isInternal;

    // Parse request body for manual triggers
    const {
      manual_trigger = false,
      manual_business_ids = null,
      force_run = false,
    } = await req.json().catch(() => ({}));

    console.log('Backup scheduler parameters:', {
      manual_trigger,
      manual_business_ids,
      force_run,
    });

    let businessesToBackup;

    if (manual_business_ids && Array.isArray(manual_business_ids)) {
      console.log(`Manual backup requested for ${manual_business_ids.length} businesses`);

      const query = supabase
        .from('businesses')
        .select('id, name, user_id')
        .in('id', manual_business_ids);

      const { data: businesses, error } = await query;

      if (error) throw error;

      if (businesses?.length === 0 && !isInternal) {
        return errorResponse('Unauthorized or business not found', 403);
      }

      businessesToBackup = businesses || [];
    } else {
      console.log('Automatic backup scheduler running');

      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);

      const { data: schedules, error: schedulesError } = await supabase
        .from('schedules')
        .select(`
          business_id,
          schedule,
          last_run,
          next_run,
          status,
          businesses!inner(id, name, user_id)
        `)
        .eq('schedule_type', 'system_backup')
        .eq('status', 'active');

      if (schedulesError) throw schedulesError;

      businessesToBackup = schedules
        .filter(schedule => {
          if (!schedule.businesses) return false;

          if (!schedule.next_run) return true; // No next backup scheduled

          const nextBackup = new Date(schedule.next_run);
          return nextBackup <= now;
        })
        .map(schedule => schedule.businesses)
        .filter(Boolean);
    }

    if (!businessesToBackup || businessesToBackup.length === 0) {
      console.log('No businesses need backup at this time');
      return successResponse({
        success: true,
        message: 'No businesses need backup',
        businesses_checked: 0,
        timestamp: new Date().toISOString(),
      });
    }

    console.log(`Found ${businessesToBackup.length} businesses that need backup`);

    // Limit processing to prevent overload (max 5 businesses per run)
    const maxBusinesses = 3;
    const businessesToProcess = businessesToBackup.slice(0, maxBusinesses);

    console.log(
      `Processing ${businessesToProcess.length} businesses (limited to prevent overload)`,
    );

    // Process each business
    const results: Array<{
      business_id: string;
      business_name: string;
      status: string;
      reason?: string;
      error?: any;
      next_run?: any;
      response?: any;
    }> = [];
    let successCount = 0;
    let failureCount = 0;

    // Batch fetch all running backups and schedules
    const businessIds = businessesToProcess.map(b => b.id);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    const [runningBackupsResult, schedulesResult] = await Promise.all([
      supabase
        .from('backup_logs')
        .select('business_id')
        .in('business_id', businessIds)
        .eq('backup_status', 'running')
        .gte('backup_started_at', twoHoursAgo),
      supabase
        .from('schedules')
        .select('business_id, next_run')
        .eq('schedule_type', 'system_backup')
        .in('business_id', businessIds),
    ]);

    // Create lookup maps
    const runningBackupMap = new Set(
      (runningBackupsResult.data || []).map(r => r.business_id),
    );
    const scheduleMap = (schedulesResult.data || []).reduce((acc, s) => {
      acc[s.business_id] = s.next_run;
      return acc;
    }, {});

    const internalHeaders = getInternalHeaders();

    for (const business of businessesToProcess) {
      try {
        console.log(`🔄 Starting backup for business: ${business.name} (${business.id})`);

        // Check if backup is already running
        if (runningBackupMap.has(business.id)) {
          console.log(`⚠️ Backup already running for ${business.name}, skipping`);
          results.push({
            business_id: business.id,
            business_name: business.name,
            status: 'skipped',
            reason: 'Backup already running',
          });
          continue;
        }

        // Check if backup is due
        const nextBackup = scheduleMap[business.id];
        if (nextBackup) {
          const nextBackupDate = new Date(nextBackup);
          const now = new Date();

          console.log('Next backup:', nextBackupDate);

          if (nextBackupDate > now) {
            console.log(
              `⏰ Backup not due yet for ${business.name}, next backup at: ${nextBackupDate.toISOString()}`,
            );
            results.push({
              business_id: business.id,
              business_name: business.name,
              status: 'skipped',
              reason: `Backup not due yet, next backup at: ${nextBackupDate.toISOString()}`,
            });
            continue;
          }
        }

        console.log(`✅ Backup is due for ${business.name}, proceeding...`);

        const { data: backupResponse, error: backupError } =
          await supabase.functions.invoke('backup-management', {
            body: {
              action: 'backup',
              business_id: business.id,
              manual_trigger: manual_trigger,
            },
            headers: internalHeaders,
          });

        if (backupError) {
          console.error(`❌ Backup failed for ${business.name}:`, backupError);
          results.push({
            business_id: business.id,
            business_name: business.name,
            status: 'failed',
            error: backupError.message,
          });
          failureCount++;
        } else {
          if (backupResponse?.backup_status === 'skipped') {
            console.log(
              `⏰ Backup skipped for ${business.name}: ${backupResponse.reason}`,
            );
            results.push({
              business_id: business.id,
              business_name: business.name,
              status: 'skipped',
              reason: backupResponse.reason,
              next_run: backupResponse.next_run,
            });
          } else {
            console.log(`✅ Backup completed for ${business.name}:`, backupResponse);

            // Trigger cleanup after successful backup
            try {
              console.log(`🧹 Triggering cleanup for ${business.name}...`);
              const { data: cleanupResult, error: cleanupError } =
                await supabase.functions.invoke('data-cleanup', {
                  body: {
                    action: 'backups',
                    business_id: business.id,
                  },
                  headers: internalHeaders,
                });

              if (cleanupError) {
                console.warn(
                  `⚠️ Cleanup failed for ${business.name}:`,
                  cleanupError.message,
                );
              } else if (cleanupResult?.success) {
                console.log(
                  `✅ Cleanup completed for ${business.name}: ${cleanupResult.results?.backups?.cleaned_count ?? 0} files cleaned`,
                );
              }
            } catch (cleanupErr) {
              console.warn(`⚠️ Cleanup error for ${business.name}:`, cleanupErr.message);
            }

            results.push({
              business_id: business.id,
              business_name: business.name,
              status: 'completed',
              response: backupResponse,
            });
            successCount++;
          }
        }

        // Add delay between businesses to prevent overload
        if (businessesToProcess.indexOf(business) < businessesToProcess.length - 1) {
          console.log('⏳ Waiting 2 seconds before next business...');
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (businessError) {
        console.error(`❌ Error processing business ${business.name}:`, businessError);
        results.push({
          business_id: business.id,
          business_name: business.name,
          status: 'error',
          error: businessError.message,
        });
        failureCount++;
      }
    }

    const endTime = new Date();
    const duration = Math.round((endTime.getTime() - startTime.getTime()) / 1000);

    console.log(`🏁 Backup scheduler completed in ${duration} seconds`);
    console.log(`📊 Results: ${successCount} successful, ${failureCount} failed`);

    return successResponse({
      success: true,
      message: 'Backup scheduler completed',
      summary: {
        total_businesses: businessesToBackup.length,
        processed: businessesToProcess.length,
        successful: successCount,
        failed: failureCount,
        skipped: results.filter(r => r.status === 'skipped').length,
      },
      results: results,
      duration_seconds: duration,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Backup scheduler failed:', error);

    return errorResponse(error.message, 500);
  }
});
