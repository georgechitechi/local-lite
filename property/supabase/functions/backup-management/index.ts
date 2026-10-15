import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import {
  EXCLUDED_TABLES,
  errorResponse,
  filterExcludedColumns,
  getClientContext,
  handleCors,
  RestoreEngine,
  setupProgressBroadcasting,
  successResponse,
} from '../_shared/index.ts';

serve(async req => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  const startTime = new Date();

  let supabase;
  let isInternal = false;
  let userIdForMapping = null;

  try {
    const ctx = await getClientContext(req);
    if (ctx.error) return errorResponse(ctx.error, 401);

    isInternal = ctx.isInternal;
    supabase = ctx.supabase;
    if (ctx.user) userIdForMapping = ctx.user.id;

    // Parse request body
    let body: any = {};
    if (req.method === 'POST') {
      try {
        body = await req.clone().json();
      } catch (e) {
        console.error('Failed to parse request body:', e.message);
      }
    }

    const action = body.action;

    if (action === 'backup') {
      return await handleBackup(
        supabase,
        body,
        body.manual_trigger || false,
        startTime,
        req,
      );
    } else if (action === 'restore') {
      return await handleRestore(
        supabase,
        body,
        isInternal,
        userIdForMapping,
        startTime,
        req,
      );
    } else {
      return errorResponse('Invalid action. Must be "backup" or "restore"', 400);
    }
  } catch (error: any) {
    console.error('❌ Backup management failed:', error);
    return errorResponse(error.message || String(error), 500);
  }
});

// =====================================
// BACKUP LOGIC
// =====================================
async function handleBackup(
  supabase: any,
  body: any,
  manual_trigger: boolean,
  _startTime: Date,
  _req: Request,
) {
  const business_id = body.business_id;
  manual_trigger = body.manual_trigger || false;

  console.log(`Backing up business ${business_id}${manual_trigger ? ' (manual)' : ''}`);

  if (!business_id) {
    throw new Error('business_id is required');
  }

  if (!manual_trigger) {
    const { data: schedule } = await supabase
      .from('schedules')
      .select('next_run')
      .eq('business_id', business_id)
      .eq('schedule_type', 'system_backup')
      .maybeSingle();

    if (schedule?.next_run) {
      const nextBackup = new Date(schedule.next_run);
      const now = new Date();

      if (nextBackup > now) {
        console.log(`Backup not due yet, next: ${nextBackup.toISOString()}`);
        return successResponse({
          success: true,
          message: 'Backup skipped - not due yet',
          business_id: business_id,
          next_run: nextBackup.toISOString(),
          backup_status: 'skipped',
          reason: 'Backup not due yet',
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  const { data: business, error: businessError } = await supabase
    .from('businesses')
    .select('id, name, user_id, email')
    .eq('id', business_id)
    .single();

  if (businessError || !business) {
    throw new Error(`Business not found or access denied: ${business_id}`);
  }

  console.log(`Business: ${business.name}`);

  const backupData = await exportBusinessData(supabase, business_id, business.user_id);

  let { data: schedule } = await supabase
    .from('schedules')
    .select('schedule, emails, metadata')
    .eq('business_id', business_id)
    .eq('schedule_type', 'system_backup')
    .maybeSingle();

  if (!schedule) {
    console.log('Creating default backup schedule');
    const { data: newSchedule, error: createScheduleError } = await supabase
      .from('schedules')
      .insert({
        business_id: business_id,
        user_id: business.user_id,
        schedule_type: 'system_backup',
        status: 'active',
        schedule: { frequency: 'daily', time: '03:00:00' },
        emails: [],
        last_run: null,
        next_run: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })
      .select('schedule, emails, metadata')
      .single();

    if (createScheduleError) {
      console.error('Failed to create backup schedule:', createScheduleError);
      schedule = { schedule: { frequency: 'daily', time: '03:00:00' }, emails: [] };
    } else {
      schedule = newSchedule;
    }
  }

  const jsonData = JSON.stringify({
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    data: backupData,
  });

  const maxSize = 50000000; // 50MB
  if (jsonData.length > maxSize) {
    throw new Error(
      `Backup size (${jsonData.length} bytes) exceeds maximum allowed size (${maxSize} bytes)`,
    );
  }

  let uploadResult = null;
  let storageSuccess = false;

  try {
    console.log('Uploading to storage...');
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, -5);

    const folderPath = `backups/${business.name}/${date}`;
    const backupFileName = `${timestamp}.json`;
    const backupFilePath = `${folderPath}/${backupFileName}`;

    const { error: backupError } = await supabase.storage
      .from('private-assets')
      .upload(backupFilePath, jsonData, {
        contentType: 'application/json',
        upsert: false,
      });

    if (backupError)
      throw new Error(`Failed to upload backup file: ${backupError.message}`);

    const { data: backupUrl } = supabase.storage
      .from('private-assets')
      .getPublicUrl(backupFilePath);

    uploadResult = {
      success: true,
      storage_type: 'supabase_storage',
      backup_file: {
        name: backupFileName,
        path: backupFilePath,
        url: backupUrl.publicUrl,
        size: jsonData.length,
        content: jsonData,
      },
      folder_path: folderPath,
    };

    storageSuccess = true;
    console.log('Upload to Supabase successful');
  } catch (error) {
    console.error('Storage Upload Failed:', error);
    uploadResult = { success: false, error: error.message };
  }

  if (!storageSuccess) {
    throw new Error('All storage upload attempts failed. Backup was not saved.');
  }

  // Update schedule last_run
  await supabase
    .from('schedules')
    .update({
      last_run: new Date().toISOString(),
      next_run: calculateNextRun(schedule.schedule),
      updated_at: new Date().toISOString(),
    })
    .eq('business_id', business_id)
    .eq('schedule_type', 'system_backup');

  // Log backup
  await supabase.from('backup_logs').insert({
    business_id: business_id,
    user_id: business.user_id,
    backup_url: uploadResult.backup_file.url,
    file_size_bytes: uploadResult.backup_file.size,
    status: 'completed',
    metadata: {
      storage_type: uploadResult.storage_type,
      manual_trigger: manual_trigger,
      file_path: uploadResult.backup_file.path,
    },
  });

  return successResponse({
    success: true,
    message: 'Backup completed successfully',
    business_id: business_id,
    uploadResult,
    backup_status: 'completed',
    timestamp: new Date().toISOString(),
  });
}

// =====================================
// RESTORE LOGIC
// =====================================
async function handleRestore(
  supabase: any,
  body: any,
  isInternal: boolean,
  userIdForMapping: string | null,
  _startTime: Date,
  req: Request,
) {
  console.log('🚀 [NEW] Starting restore backup at:', new Date().toISOString());

  // 1. PROGRESS BROADCASTING
  const { user_id: broadcastUserId, sendProgress } = await setupProgressBroadcasting(
    req,
    supabase,
  );
  if (!userIdForMapping) userIdForMapping = broadcastUserId;

  // 2. PARSE & DOWNLOAD BACKUP
  await sendProgress('Initializing backup source...', 'system', 0.05);
  let backup = null;

  if (body.backup_data) {
    backup = body.backup_data;
  } else if (body.backup_content) {
    try {
      backup = JSON.parse(body.backup_content);
    } catch (e) {
      throw new Error(`Invalid JSON content: ${e.message}`);
    }
  } else if (body.backup_url) {
    try {
      const response = await fetch(body.backup_url);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      backup = await response.json();
    } catch (e) {
      throw new Error(`Failed to download backup: ${e.message}`);
    }
  } else {
    throw new Error(
      'No backup data provided (backup_data, backup_content, or backup_url required)',
    );
  }

  // 3. VALIDATE FORMAT
  if (!backup?.version || !backup?.data) throw new Error('Invalid backup format');

  // 4. EXECUTE RESTORATION VIA ENGINE
  const engine = new RestoreEngine({
    supabase,
    sendProgress,
    userIdForMapping,
    isInternal,
  });

  const result = await engine.execute(backup);

  // 5. FINALIZE & RESPOND
  const status =
    result.failedTables === 0 ? 'completed successfully!' : 'completed with issues.';
  await sendProgress(`Restoration ${status}`, 'finalizing', 1.0, {
    completed: true,
    success: result.success,
    total_records_restored: result.totalRecordsRestored,
    failed_tables: result.failedTables,
    duration: result.duration,
    businesses_restored: result.businessesRestored,
    business_names: result.businessNames,
    restore_results:
      result.results.length > 20 ? 'too_many_to_broadcast' : result.results,
  });

  return successResponse({
    success: result.success,
    total_records_restored: result.totalRecordsRestored,
    restore_results: result.results,
    failed_tables: result.failedTables,
    duration: result.duration,
    businesses_restored: result.businessesRestored,
    business_names: result.businessNames,
    timestamp: new Date().toISOString(),
  });
}

// =====================================
// UTILS
// =====================================
function calculateNextRun(scheduleDef: any): string {
  const now = new Date();
  const nextRun = new Date(now);

  if (scheduleDef?.time) {
    const [hours, minutes] = scheduleDef.time.split(':');
    nextRun.setUTCHours(parseInt(hours, 10), parseInt(minutes || '0', 10), 0, 0);
  } else {
    nextRun.setUTCHours(0, 0, 0, 0);
  }

  if (nextRun <= now) {
    if (scheduleDef?.frequency === 'daily') {
      nextRun.setUTCDate(nextRun.getUTCDate() + 1);
    } else if (scheduleDef?.frequency === 'weekly') {
      nextRun.setUTCDate(nextRun.getUTCDate() + 7);
    } else if (scheduleDef?.frequency === 'monthly') {
      nextRun.setUTCMonth(nextRun.getUTCMonth() + 1);
    } else {
      nextRun.setUTCDate(nextRun.getUTCDate() + 1);
    }
  }

  return nextRun.toISOString();
}

async function exportBusinessData(supabase: any, businessId: string, userId: string) {
  const { data: tablesData, error: tablesError } = await supabase.rpc('list_tables');
  if (tablesError) throw new Error(`Failed to get table list: ${tablesError.message}`);

  const data: Record<string, any[]> = {};
  const tablesToBackup = tablesData
    .map((table: any) => table.table_name)
    .filter((table: string) => !EXCLUDED_TABLES.includes(table));

  for (const tableName of tablesToBackup) {
    let query = supabase.from(tableName).select('*');
    if (tableName === 'users' || tableName === 'businesses') {
      query = query.eq('id', tableName === 'users' ? userId : businessId);
    } else if (tableName === 'profiles') {
      query = query.eq('id', userId);
    } else {
      query = query.eq('business_id', businessId);
    }
    const { data: tableData, error } = await query;
    if (!error && tableData) {
      data[tableName] = filterExcludedColumns(tableData);
    }
  }
  return data;
}
