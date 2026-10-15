const CENTRAL_URL =
  typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_CENTRAL_URL
    ? process.env.EXPO_PUBLIC_CENTRAL_URL
    : undefined;

const DEPLOYMENT_SERVICE_URL = CENTRAL_URL
  ? `${CENTRAL_URL}/functions/v1/deploy-supabase`
  : undefined;

export type WorkflowRunStatus = 'queued' | 'in_progress' | 'completed';
export type WorkflowRunConclusion =
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'skipped'
  | null;

export interface WorkflowStep {
  name: string;
  status: WorkflowRunStatus;
  conclusion: WorkflowRunConclusion;
  number: number;
}

export interface WorkflowPollResult {
  runId: number | null;
  runStatus: WorkflowRunStatus | null;
  runConclusion: WorkflowRunConclusion;
  steps: WorkflowStep[];
  htmlUrl: string | null;
}

async function deploymentRequest<T>(body: object): Promise<T> {
  if (!DEPLOYMENT_SERVICE_URL) {
    throw new Error('Deployment service is not configured. Rebuild the app.');
  }

  const response = await fetch(DEPLOYMENT_SERVICE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(result?.error || `Deployment service failed (${response.status})`);
  }
  return result?.data ?? result;
}

/**
 * Trigger the deployment workflow.
 */
export async function triggerDeploy(
  supabaseAccessToken: string,
  supabaseProjectId: string,
  supabaseDbPassword?: string,
): Promise<Date> {
  // Capture timestamp to identify the new run later
  const triggeredAt = new Date();
  // subtract 5 seconds to account for clock skew
  triggeredAt.setSeconds(triggeredAt.getSeconds() - 5);

  const data = await deploymentRequest<{ triggeredAt?: string }>({
    action: 'trigger',
    accessToken: supabaseAccessToken,
    projectId: supabaseProjectId,
    dbPassword: supabaseDbPassword || '',
  });
  return data.triggeredAt ? new Date(data.triggeredAt) : triggeredAt;
}

/**
 * Poll the latest workflow run that started after triggeredAt.
 */
export async function pollDeployStatus(triggeredAt: Date): Promise<WorkflowPollResult> {
  const data = await deploymentRequest<WorkflowPollResult>({
    action: 'status',
    triggeredAt: triggeredAt.toISOString(),
  });
  if (!data) {
    return {
      runId: null,
      runStatus: null,
      runConclusion: null,
      steps: [],
      htmlUrl: null,
    };
  }

  return data as WorkflowPollResult;
}
