import { serverSupabase } from '@/shared/services/supabase';

export interface AuthResult {
  valid: boolean;
  business_id?: string;
  scopes?: string[];
}

/**
 * Common authentication check for API routes.
 * Verifies the x-api-key header against the database.
 */
export const checkAuth = async (request: Request): Promise<AuthResult | null> => {
  const apiKey = request.headers.get('x-api-key');
  if (!apiKey) return null;

  try {
    // Dynamic DB verification (Optimized prefix lookup)
    const { data, error } = await serverSupabase.rpc('verify_api_key', {
      p_api_key: apiKey,
    });

    if (error) {
      console.error('Auth verification RPC error:', error);
      return null;
    }

    const result = data as AuthResult | null;
    return result?.valid ? result : null;
  } catch (err) {
    console.error('Unexpected error during auth verification:', err);
    return null;
  }
};
