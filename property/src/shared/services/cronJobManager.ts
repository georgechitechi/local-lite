import type { SupabaseClient } from '@supabase/supabase-js';

export interface CronJobResult {
  success: boolean;
  job_id?: number;
  job_name?: string;
  schedule?: string;
  command?: string;
  message?: string;
  error?: string;
  detail?: string;
}

class CronJobManager {
  private supabaseUrl: string;

  constructor(
    private supabase: SupabaseClient,
    supabaseUrl: string,
  ) {
    this.supabaseUrl = supabaseUrl;
  }

  /**
   * Build SQL command to call edge function via HTTP POST
   */
  private buildEdgeFunctionCommand(
    edgeFunction: string,
    payload?: Record<string, any>,
    condition?: string,
  ): string {
    const url = `${this.supabaseUrl}/functions/v1/${edgeFunction}`;
    const payloadJson = payload ? JSON.stringify(payload).replace(/'/g, "''") : '{}';

    const httpPost = `net.http_post(
            url := '${url}',
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'x-api-key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'APP_SECRET_KEY' LIMIT 1)
            ),
            body := '${payloadJson}'::jsonb,
            timeout_milliseconds := 30000
        )`;

    if (condition) {
      return `DO $$
BEGIN
    IF ${condition} THEN
        PERFORM ${httpPost};
    END IF;
END $$;`;
    }

    return `SELECT ${httpPost}`;
  }

  /**
   * Sync master cron job for reports (single job that processes all due schedules)
   * This creates/updates a single cron job that runs periodically and checks all report schedules
   */
  async syncMasterReportJob(schedule: string = '0 * * * *'): Promise<CronJobResult> {
    const jobName = 'reports_scheduler';
    const command = this.buildEdgeFunctionCommand('reports');

    // Check if job exists
    const existingJob = await this.getJob(jobName);

    if (existingJob.success) {
      // Update existing job schedule if needed
      return this.updateJob({
        jobName,
        newSchedule: schedule,
        newCommand: command,
      });
    } else {
      // Create new master job
      return this.createJob({
        jobName,
        schedule,
        command,
      });
    }
  }

  /**
   * Remove master report cron job
   */
  async removeMasterReportJob(): Promise<CronJobResult> {
    return this.removeJob('reports_scheduler');
  }

  /**
   * Sync master cron job for backups (single job that processes all due backup schedules)
   * This creates/updates a single cron job that runs periodically and checks all backup schedules
   */
  async syncMasterBackupJob(schedule: string = '0 * * * *'): Promise<CronJobResult> {
    const jobName = 'backup_scheduler';
    const command = this.buildEdgeFunctionCommand('backup-scheduler');

    // Check if job exists
    const existingJob = await this.getJob(jobName);

    if (existingJob.success) {
      // Update existing job schedule if needed
      return this.updateJob({
        jobName,
        newSchedule: schedule,
        newCommand: command,
      });
    } else {
      // Create new master job
      return this.createJob({
        jobName,
        schedule,
        command,
      });
    }
  }

  /**
   * Remove master backup cron job
   */
  async removeMasterBackupJob(): Promise<CronJobResult> {
    return this.removeJob('backup_scheduler');
  }

  /**
   * Create a new cron job
   */
  async createJob(params: {
    jobName: string;
    schedule: string;
    command: string;
  }): Promise<CronJobResult> {
    const { data, error } = await this.supabase.rpc('create_cron_job', {
      p_job_name: params.jobName,
      p_schedule: params.schedule,
      p_command: params.command,
    });

    if (error) {
      return {
        success: false,
        error: error.message,
      };
    }

    return data as CronJobResult;
  }

  /**
   * Get details of a specific cron job
   */
  async getJob(jobName: string): Promise<CronJobResult> {
    const { data, error } = await this.supabase.rpc('get_cron_job', {
      p_job_name: jobName,
    });

    if (error) {
      return {
        success: false,
        error: error.message,
      };
    }

    const result = data as { success: boolean; job?: any; error?: string } | null;

    if (!result?.success || !result.job) {
      return {
        success: false,
        error: result?.error || 'Job not found',
      };
    }

    return {
      success: true,
      job_id: result.job.job_id,
      job_name: result.job.job_name,
      schedule: result.job.schedule,
      command: result.job.command,
    };
  }

  /**
   * Update a cron job's schedule or command
   */
  async updateJob(params: {
    jobName: string;
    newSchedule?: string;
    newCommand?: string;
  }): Promise<CronJobResult> {
    const { data, error } = await this.supabase.rpc('update_cron_job', {
      p_job_name: params.jobName,
      p_new_schedule: params.newSchedule,
      p_new_command: params.newCommand,
    });

    if (error) {
      return {
        success: false,
        error: error.message,
      };
    }

    return data as CronJobResult;
  }

  /**
   * Remove a cron job
   */
  async removeJob(jobName: string): Promise<CronJobResult> {
    const { data, error } = await this.supabase.rpc('remove_cron_job', {
      p_job_name: jobName,
    });

    if (error) {
      return {
        success: false,
        error: error.message,
      };
    }

    const result = data as CronJobResult | null;

    if (!result) {
      return {
        success: false,
        error: 'No response from database',
      };
    }

    // If job doesn't exist, consider it successful removal
    if (!result.success && result.error?.includes('not found')) {
      return {
        success: true,
        message: 'Job does not exist (already removed)',
      };
    }

    return result;
  }

  /**
   * Ensure a cron job exists with specific configuration
   */
  async ensureJob(params: {
    jobName: string;
    schedule: string;
    command: string;
  }): Promise<CronJobResult> {
    const existingJob = await this.getJob(params.jobName);

    if (existingJob.success) {
      return this.updateJob({
        jobName: params.jobName,
        newSchedule: params.schedule,
        newCommand: params.command,
      });
    } else {
      const result = await this.createJob(params);

      // If creation failed, ensure no partial configuration exists
      if (!result?.success) {
        console.warn(`Failed to create job ${params.jobName}, attempting cleanup`);
        await this.removeJob(params.jobName).catch(cleanupError => {
          console.error('Cleanup failed:', cleanupError);
        });
      }

      return result || { success: false, error: 'Job creation failed' };
    }
  }

  /**
   * Get list of all available system jobs with their definitions
   */
  getAvailableJobs() {
    return [
      {
        jobName: 'reports_scheduler',
        schedule: '0 * * * *',
        command: this.buildEdgeFunctionCommand('reports'),
        description: 'Master Reports Scheduler',
      },
      {
        jobName: 'backup_scheduler',
        schedule: '0 * * * *',
        command: this.buildEdgeFunctionCommand('backup-scheduler'),
        description: 'Master Backup Scheduler',
      },
      {
        jobName: 'mark-expired-contracts',
        schedule: '0 10 * * *',
        command: 'SELECT mark_expired_contracts();',
        description: 'Mark Expired Contracts',
      },
      {
        jobName: 'check-expiring-contracts',
        schedule: '0 9 * * *',
        command: this.buildEdgeFunctionCommand('contract-management', { action: 'scan' }),
        description: 'Check Expiring Contracts',
      },
      {
        jobName: 'fix-database',
        schedule: '0 4 * * *',
        command: this.buildEdgeFunctionCommand('fix-database', { action: 'fix' }),
        description: 'Database Integrity Auto-Fix',
      },
      {
        jobName: 'bulk_messages_job',
        schedule: '*/5 * * * *',
        command: this.buildEdgeFunctionCommand(
          'process-messages',
          { action: 'process_queue' },
          'EXISTS (SELECT 1 FROM pgmq.q_bulk_messages WHERE vt <= clock_timestamp())',
        ),
        description: 'Bulk Messages Processor',
      },
    ];
  }

  /**
   * Setup specific cron jobs by name
   */
  async setupJobs(jobNames: string[]): Promise<{
    success: boolean;
    results: CronJobResult[];
  }> {
    const availableJobs = this.getAvailableJobs();
    const jobsToSetup = availableJobs.filter(job => jobNames.includes(job.jobName));
    const results: CronJobResult[] = [];

    for (const job of jobsToSetup) {
      results.push(await this.ensureJob(job));
    }

    const allSuccess = results.every(r => r.success);
    return { success: allSuccess, results };
  }

  /**
   * Get statuses of all system jobs
   */
  async getSystemJobStatuses(): Promise<
    (ReturnType<CronJobManager['getAvailableJobs']>[0] & {
      exists: boolean;
      currentSchedule?: string;
      lastStatus?: string;
    })[]
  > {
    const jobs = this.getAvailableJobs();
    const results = [];

    for (const job of jobs) {
      const status = await this.getJob(job.jobName);
      results.push({
        ...job,
        exists: status.success,
        currentSchedule: status.schedule,
        lastStatus: status.success ? 'Active' : 'Not configured',
      });
    }

    return results;
  }

  /**
   * Setup all required cron jobs for the application
   */
  async setupAllCronJobs(): Promise<{
    success: boolean;
    results: CronJobResult[];
  }> {
    const allJobs = this.getAvailableJobs();
    const allJobNames = allJobs.map(j => j.jobName);
    return this.setupJobs(allJobNames);
  }
}

/**
 * Create a CronJobManager instance
 */
export const createCronJobManager = (supabase: SupabaseClient, supabaseUrl: string) => {
  return new CronJobManager(supabase, supabaseUrl);
};
