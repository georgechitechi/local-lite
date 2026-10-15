export interface GitHubReleaseAsset {
  id: number;
  name: string;
  size: number;
  browser_download_url: string;
  content_type: string;
}

export interface GitHubDevRelease {
  id: number;
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  html_url: string;
  apkAsset: GitHubReleaseAsset | null;
}

const CENTRAL_URL =
  typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_CENTRAL_URL
    ? process.env.EXPO_PUBLIC_CENTRAL_URL
    : undefined;

export async function fetchLatestDevRelease(): Promise<{
  release: GitHubDevRelease | null;
  error: string | null;
}> {
  try {
    if (!CENTRAL_URL) {
      return {
        release: null,
        error: 'Central platform URL (EXPO_PUBLIC_CENTRAL_URL) is not configured.',
      };
    }

    const deployEndpoint = `${CENTRAL_URL}/functions/v1/deploy-supabase`;

    const response = await fetch(deployEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'latest-dev-release' }),
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => null);
      return {
        release: null,
        error: errJson?.error || `Request failed with status ${response.status}`,
      };
    }

    const json = await response.json();
    const data = json?.data ?? json;

    if (!data?.release) {
      return {
        release: null,
        error: data?.message || "No development release found containing 'dev'.",
      };
    }

    const rawRelease = data.release;
    const apkAsset = rawRelease.apkAsset;

    return {
      release: {
        id: rawRelease.id,
        tag_name: rawRelease.tag_name,
        name: rawRelease.name || rawRelease.tag_name,
        body: rawRelease.body || '',
        published_at: rawRelease.published_at,
        html_url: rawRelease.html_url,
        apkAsset: apkAsset
          ? {
              id: apkAsset.id,
              name: apkAsset.name,
              size: apkAsset.size,
              browser_download_url: `${deployEndpoint}?action=download&asset_id=${apkAsset.id}`,
              content_type: 'application/vnd.android.package-archive',
            }
          : null,
      },
      error: null,
    };
  } catch (err: any) {
    console.error('Failed to fetch dev releases:', err);
    return {
      release: null,
      error: err.message || 'Network error while checking dev releases.',
    };
  }
}

export function formatBytes(bytes: number, decimals: number = 1): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(dm))} ${sizes[i]}`;
}
