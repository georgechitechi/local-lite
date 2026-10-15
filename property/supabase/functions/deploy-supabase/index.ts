// @ts-nocheck
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { errorResponse, handleCors, successResponse } from '../_shared/index.ts';

const WORKFLOW_FILE = 'deploy-supabase.yml';

const githubRequest = async (method: string, path: string, body?: unknown) => {
  const token = Deno.env.get('GITHUB_TOKEN');
  const repository = Deno.env.get('GITHUB_REPO');
  if (!token || !repository) throw new Error('Deployment service is not configured');

  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'PropertyAdmin-DeployService',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    let detailedMsg = '';
    try {
      const parsed = JSON.parse(errorText);
      detailedMsg = parsed.message || '';
    } catch {}
    console.error(
      `[GitHub API] ${method} ${path} failed (${response.status}):`,
      errorText,
    );
    throw new Error(
      `Deployment service request failed (${response.status})${detailedMsg ? `: ${detailedMsg}` : ''}`,
    );
  }
  return response.status === 204 ? null : response.json();
};

const getLatestDevRelease = async () => {
  const repository = Deno.env.get('GITHUB_REPO');
  const releases = await githubRequest(
    'GET',
    `/repos/${repository}/releases?per_page=30`,
  );
  if (!Array.isArray(releases) || releases.length === 0) {
    return { release: null, message: 'No releases found on GitHub repository' };
  }

  let devRelease: any = null;
  let devApkAsset: any = null;

  for (const r of releases) {
    const assets = Array.isArray(r.assets) ? r.assets : [];

    // 1. Check if asset ends with .apk and contains 'dev' in the filename
    const devApk = assets.find((a: any) => {
      const aName = String(a.name || '').toLowerCase();
      return aName.endsWith('.apk') && aName.includes('dev');
    });

    if (devApk) {
      devRelease = r;
      devApkAsset = devApk;
      break;
    }

    // 2. Fallback: Check if release tag or name contains 'dev'
    const tag = String(r.tag_name || '').toLowerCase();
    const name = String(r.name || '').toLowerCase();
    if (tag.includes('dev') || name.includes('dev')) {
      const anyApk = assets.find((a: any) =>
        String(a.name || '')
          .toLowerCase()
          .endsWith('.apk'),
      );
      if (anyApk) {
        devRelease = r;
        devApkAsset = anyApk;
        break;
      }
    }
  }

  if (!devRelease || !devApkAsset) {
    return {
      release: null,
      message: "No release found with a 'dev' APK asset.",
    };
  }

  return {
    release: {
      id: devRelease.id,
      tag_name: devRelease.tag_name,
      name: devRelease.name || devRelease.tag_name,
      body: devRelease.body || '',
      published_at: devRelease.published_at,
      html_url: devRelease.html_url,
      apkAsset: {
        id: devApkAsset.id,
        name: devApkAsset.name,
        size: devApkAsset.size,
      },
    },
  };
};

serve(async req => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const url = new URL(req.url);

  // Handle GET requests (e.g. browser downloads or curl testing)
  if (req.method === 'GET') {
    const action = url.searchParams.get('action');

    if (action === 'download') {
      const assetId = url.searchParams.get('asset_id');
      if (!assetId) return errorResponse('Missing asset_id query param', 400);

      const token = Deno.env.get('GITHUB_TOKEN');
      const repository = Deno.env.get('GITHUB_REPO');
      if (!token || !repository)
        return errorResponse('Deployment service is not configured', 500);

      try {
        const ghRes = await fetch(
          `https://api.github.com/repos/${repository}/releases/assets/${assetId}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/octet-stream',
              'User-Agent': 'PropertyAdmin-DeployService',
              'X-GitHub-Api-Version': '2022-11-28',
            },
            redirect: 'manual',
          },
        );

        const location = ghRes.headers.get('location');
        if (location) {
          return Response.redirect(location, 302);
        }
        return errorResponse('Failed to retrieve binary download URL from GitHub', 502);
      } catch (err) {
        return errorResponse(err?.message || 'Download redirection failed', 500);
      }
    }

    if (action === 'latest-dev-release' || action === 'releases') {
      try {
        const data = await getLatestDevRelease();
        return successResponse(data);
      } catch (err) {
        return errorResponse(err?.message || 'Failed to fetch releases', 500);
      }
    }

    return errorResponse('Invalid GET action', 400);
  }

  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const projectId = String(body.projectId || '').trim();

    if (action === 'latest-dev-release' || action === 'releases') {
      const data = await getLatestDevRelease();
      return successResponse(data);
    }

    if (action === 'trigger') {
      if (!projectId || !/^[a-z0-9-]+$/i.test(projectId)) {
        return errorResponse('Invalid project ID', 400);
      }
      const accessToken = String(body.accessToken || '').trim();
      const dbPassword = String(body.dbPassword || '').trim();
      if (!accessToken && !dbPassword) {
        return errorResponse('A deployment credential is required', 400);
      }

      const triggeredAt = new Date();
      triggeredAt.setSeconds(triggeredAt.getSeconds() - 5);
      await githubRequest(
        'POST',
        `/repos/${Deno.env.get('GITHUB_REPO')}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
        {
          ref: 'main',
          inputs: {
            supabase_access_token: accessToken,
            supabase_project_id: projectId,
            supabase_db_password: dbPassword,
          },
        },
      );
      return successResponse({ triggeredAt: triggeredAt.toISOString() });
    }

    if (action === 'status') {
      const triggeredAt = new Date(String(body.triggeredAt || ''));
      if (Number.isNaN(triggeredAt.getTime()))
        return errorResponse('Invalid timestamp', 400);

      const runsData = await githubRequest(
        'GET',
        `/repos/${Deno.env.get('GITHUB_REPO')}/actions/workflows/${WORKFLOW_FILE}/runs?created=>=${encodeURIComponent(triggeredAt.toISOString())}&per_page=1`,
      );
      const run = runsData?.workflow_runs?.[0];
      if (!run) {
        return successResponse({
          runId: null,
          runStatus: null,
          runConclusion: null,
          steps: [],
          htmlUrl: null,
        });
      }

      const jobsData = await githubRequest(
        'GET',
        `/repos/${Deno.env.get('GITHUB_REPO')}/actions/runs/${run.id}/jobs`,
      );
      const steps = (jobsData?.jobs?.[0]?.steps || []).map((step: any) => ({
        name: step.name,
        status: step.status,
        conclusion: step.conclusion,
        number: step.number,
      }));

      return successResponse({
        runId: run.id,
        runStatus: run.status,
        runConclusion: run.conclusion,
        steps,
        htmlUrl: run.html_url || null,
      });
    }

    return errorResponse('Invalid deployment action', 400);
  } catch (error) {
    console.error('[Deploy Supabase] Request failed:', error?.message || 'Unknown error');
    return errorResponse(error?.message || 'Deployment request failed', 500);
  }
});
