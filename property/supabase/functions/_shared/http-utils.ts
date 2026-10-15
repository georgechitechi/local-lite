// @ts-nocheck
import { CORS_HEADERS } from './constants.ts';

/**
 * Handles CORS preflight requests.
 * Returns a Response with status 204 if it's an OPTIONS request, otherwise returns null.
 */
export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS, status: 204 });
  }
  return null;
}

/**
 * Creates a standardized JSON success response with CORS headers.
 */
export function successResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

/**
 * Creates a standardized JSON error response with CORS headers.
 */
export function errorResponse(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
