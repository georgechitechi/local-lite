// @ts-nocheck
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import {
  errorResponse,
  getClientContext,
  handleCors,
  successResponse,
} from '../_shared/index.ts';

serve(async req => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  try {
    const ctx = await getClientContext(req);
    if (ctx.error) return errorResponse(ctx.error, 401);
    const supabase = ctx.supabase;
    const isInternal = ctx.isInternal;

    // Parse request body
    const body = (await req.json().catch(() => ({}))) || {};
    const { action, business_id } = body;

    if (!action) {
      return errorResponse(
        'Missing action property in payload (e.g., "backups", "verification-codes", or "all")',
        400,
      );
    }

    const results = {};

    // 1. Backups Cleanup
    if (action === 'backups' || action === 'all') {
      if (business_id) {
        console.log(`🧹 Starting backup cleanup for specific business: ${business_id}`);
        results.backups = await cleanupBusinessBackups(supabase, business_id);
      } else {
        if (!isInternal) {
          throw new Error('business_id is required for user-initiated backups cleanup');
        }
        console.log(`🧹 Starting backup cleanup for all businesses`);
        results.backups = await cleanupAllBusinessBackups(supabase);
      }
    }

    // 2. Verification Codes Cleanup
    if (action === 'verification-codes' || action === 'all') {
      if (!isInternal) {
        throw new Error('Unauthorized for verification codes cleanup');
      }
      console.log(`🧹 Starting verification codes cleanup`);
      results.verificationCodes = await cleanupVerificationCodes(supabase);
    }

    return successResponse({
      success: true,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Data cleanup error:', error);
    return errorResponse(error.message, error.message === 'Unauthorized' ? 401 : 500);
  }
});

// ==========================================
// BACKUP CLEANUP LOGIC
// ==========================================
async function cleanupBusinessBackups(supabase, business_id) {
  try {
    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .select('name')
      .eq('id', business_id)
      .single();

    if (businessError || !business) {
      console.error('❌ Error fetching business:', businessError);
      throw new Error('Failed to fetch business information');
    }

    const { data: scheduleData, error: scheduleError } = await supabase
      .from('schedules')
      .select('schedule')
      .eq('business_id', business_id)
      .eq('schedule_type', 'system_backup')
      .maybeSingle();

    if (scheduleError) {
      console.log('⚠️ No backup schedule found, using default retention policy');
    }

    const schedule = scheduleData?.schedule || {};
    const frequency = schedule.frequency || 'weekly';

    let retentionDays = 7;
    switch (frequency) {
      case 'daily':
        retentionDays = 3;
        break;
      case 'weekly':
        retentionDays = 7;
        break;
      case 'monthly':
        retentionDays = 30;
        break;
      default:
        retentionDays = 7;
    }

    console.log(`📅 Retention policy: ${retentionDays} days for ${frequency} backups`);

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const businessFolder = `backups/${business.name}`;

    const { data: folders, error: listError } = await supabase.storage
      .from('private-assets')
      .list(businessFolder, { limit: 1000 });

    if (listError) {
      console.error('❌ Error listing storage folders:', listError);
      throw new Error('Failed to list storage folders');
    }

    if (!folders || folders.length === 0) {
      return {
        success: true,
        message: 'No backup folders found in storage',
        cleaned_count: 0,
        retention_days: retentionDays,
      };
    }

    const staleFolders = folders.filter(folder => {
      const dateMatch = folder.name.match(/^\d{4}-\d{2}-\d{2}$/);
      if (!dateMatch) return false;

      const folderDate = new Date(folder.name);
      if (Number.isNaN(folderDate.getTime())) return false;

      return folderDate < cutoffDate;
    });

    if (staleFolders.length === 0) {
      return {
        success: true,
        message: 'No old backup folders to clean up',
        cleaned_count: 0,
        retention_days: retentionDays,
      };
    }

    let totalFilesDeleted = 0;
    const deletedFolders = [];

    for (const folder of staleFolders) {
      try {
        const folderPath = `${businessFolder}/${folder.name}`;
        const { data: folderFiles, error: listFilesError } = await supabase.storage
          .from('private-assets')
          .list(folderPath, { limit: 1000 });

        if (listFilesError) continue;

        if (!folderFiles || folderFiles.length === 0) {
          deletedFolders.push(folder.name);
          continue;
        }

        const filePaths = folderFiles.map(file => `${folderPath}/${file.name}`);
        const { error: deleteFilesError } = await supabase.storage
          .from('private-assets')
          .remove(filePaths);

        if (deleteFilesError) continue;

        totalFilesDeleted += filePaths.length;
        deletedFolders.push(folder.name);
      } catch (folderError) {
        console.error(`❌ Error processing folder ${folder.name}:`, folderError);
      }
    }

    const { data: remainingFolders } = await supabase.storage
      .from('private-assets')
      .list(businessFolder, { limit: 1000 });

    const remainingBackupCount = remainingFolders ? remainingFolders.length : 0;

    return {
      success: true,
      message: `Cleaned up ${totalFilesDeleted} files from ${deletedFolders.length} old backup folders`,
      cleaned_count: totalFilesDeleted,
      folders_cleaned: deletedFolders.length,
      retention_days: retentionDays,
      remaining_backups: remainingBackupCount,
      cutoff_date: cutoffDate.toISOString(),
      cleaned_folders: deletedFolders,
    };
  } catch (error) {
    console.error('❌ Business backup cleanup error:', error);
    throw error;
  }
}

async function cleanupAllBusinessBackups(supabase) {
  try {
    const { data: businesses, error: businessesError } = await supabase
      .from('businesses')
      .select('id, name');

    if (businessesError) throw new Error('Failed to fetch businesses');

    if (!businesses || businesses.length === 0) {
      return {
        success: true,
        message: 'No businesses found',
        total_cleaned: 0,
        businesses_processed: 0,
      };
    }

    let totalCleaned = 0;
    let businessesProcessed = 0;
    const results = [];

    for (const business of businesses) {
      try {
        const cleanupData = await cleanupBusinessBackups(supabase, business.id);

        if (cleanupData.success) {
          totalCleaned += cleanupData.cleaned_count || 0;
          businessesProcessed++;
          results.push({
            business_id: business.id,
            business_name: business.name,
            cleaned_count: cleanupData.cleaned_count || 0,
            retention_days: cleanupData.retention_days || 7,
          });
        } else {
          results.push({
            business_id: business.id,
            business_name: business.name,
            error: cleanupData.error || 'Unknown error',
            cleaned_count: 0,
          });
        }
      } catch (businessError) {
        results.push({
          business_id: business.id,
          business_name: business.name,
          error: businessError.message,
          cleaned_count: 0,
        });
      }
    }

    return {
      success: true,
      message: `Cleanup completed for all businesses`,
      total_cleaned: totalCleaned,
      businesses_processed: businessesProcessed,
      total_businesses: businesses.length,
      results: results,
    };
  } catch (error) {
    console.error('❌ All businesses cleanup error:', error);
    throw error;
  }
}

// ==========================================
// VERIFICATION CODES CLEANUP LOGIC
// ==========================================
async function cleanupVerificationCodes(supabase) {
  try {
    const { data: cleanupStats, error } = await supabase.rpc(
      'cleanup_verification_codes_with_stats',
    );

    if (error) {
      throw new Error(`Failed to cleanup verification codes: ${error.message}`);
    }

    console.log('✅ Cleanup completed:', cleanupStats);

    return {
      success: true,
      message: 'Verification codes cleanup completed',
      stats: cleanupStats,
    };
  } catch (error) {
    console.error('❌ Verification codes cleanup error:', error);
    throw error;
  }
}
