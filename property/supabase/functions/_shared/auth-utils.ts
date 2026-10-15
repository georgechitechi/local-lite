// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';

/**
 * Validates the user's JWT from the request and returns a Supabase client
 * initialized with that user's context.
 *
 * This allows the function to respect Row Level Security (RLS).
 */
export async function getAuthenticatedClient(req: Request) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    throw new Error('Missing Authorization header');
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

  // Create a client with the user's JWT
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: { Authorization: authHeader },
    },
  });

  // Verify the user is actually logged in
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    throw new Error('Invalid or expired token');
  }

  return { supabase, user };
}

/**
 * Validates a custom internal secret for CRON jobs or internal service-to-service calls.
 * This avoids passing the service_role key over the network.
 */
export function validateInternalSecret(req: Request) {
  const internalSecret = req.headers.get('x-api-key');
  const expectedSecret = Deno.env.get('APP_SECRET_KEY');

  if (!expectedSecret) {
    console.error('APP_SECRET_KEY environment variable is not set');
    return false;
  }

  return internalSecret === expectedSecret;
}

/**
 * Gets the internal headers for calling other edge functions securely.
 */
export const getInternalHeaders = () => {
  const headers = {};
  const secret = Deno.env.get('APP_SECRET_KEY');
  if (secret) {
    headers['x-api-key'] = secret;
  }
  return headers;
};

/**
 * Checks if the authenticated user has access to a specific business.
 * Note: If using the client from getAuthenticatedClient, RLS will handle this
 * automatically for DB queries. Use this function for logic-level checks.
 */
export async function checkUserBusinessAccess(supabase: any, businessId: string) {
  const { data, error } = await supabase.rpc('check_business_access', {
    business_id: businessId,
  });

  if (error) {
    console.error('Error checking business access:', error);
    return false;
  }

  return !!data;
}

/**
 * Helper to get a service role client for administrative tasks.
 * Should ONLY be used after validateInternalSecret or verifying admin status.
 */
export function getServiceRoleClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  return createClient(supabaseUrl, supabaseServiceKey);
}

/**
 * Automatically initializes and returns the Supabase client based on the request context.
 * It checks for an internal secret first (for service-to-service calls), and falls back to
 * checking the Authorization header for a user JWT.
 *
 * Returns { supabase, user, isInternal, error }
 */
export async function getClientContext(req: Request) {
  const isInternal = validateInternalSecret(req);
  const authHeader = req.headers.get('Authorization');

  let supabase = null;
  let user = null;
  let error = null;

  try {
    if (isInternal) {
      supabase = getServiceRoleClient();
    } else if (authHeader) {
      const auth = await getAuthenticatedClient(req);
      supabase = auth.supabase;
      user = auth.user;
    } else {
      error = 'Unauthorized';
    }
  } catch (err: any) {
    error = err.message || 'Unauthorized';
  }

  return { supabase, user, isInternal, error };
}
