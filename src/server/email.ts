import type { ApiEndpoint, ApiRequestContext } from './index.js';

export interface EmailEndpointOptions {
  /**
   * Secret token required in `Authorization: Bearer <secret>` or `x-app-secret` header.
   * If not set, incoming requests are processed without secret token validation.
   */
  secret?: string;

  /**
   * CORS allowed origins (e.g. '*' or 'https://myapp.com'). Default: '*'
   */
  corsOrigin?: string;

  /**
   * Direct Nodemailer transporter instance, SMTP options, or custom dispatcher function.
   */
  transport?: any;

  /**
   * HTTP email provider if relaying through an API (e.g. 'resend', 'sendgrid', 'postmark').
   */
  provider?: 'nodemailer' | 'resend' | 'sendgrid' | 'postmark' | 'dev';

  /**
   * API Key for provider if relaying.
   */
  apiKey?: string;

  /**
   * Custom dispatch function: receives the parsed email payload and returns { messageId, ... }.
   */
  dispatch?: (payload: any, request: Request) => Promise<any> | any;

  /**
   * Fallback 'from' address if not present in request payload.
   */
  defaultFrom?: string;

  /**
   * Hook called before dispatching to sanitize or validate payload.
   */
  beforeSend?: (payload: any, request: Request) => Promise<any | void> | any | void;
}

/**
 * Creates a turnkey Request/Response API endpoint for receiving offline-enqueued emails
 * from local-lite clients and dispatching them via Nodemailer or cloud providers.
 */
export function createEmailEndpoint(options: EmailEndpointOptions = {}): ApiEndpoint {
  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin': options.corsOrigin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-App-Secret, X-Message-ID',
  };

  const handlePost = async ({ request }: ApiRequestContext<unknown>): Promise<Response> => {
    // 1. Check secret token if configured
    if (options.secret) {
      const authHeader = request.headers.get('authorization') || request.headers.get('x-app-secret');
      const expectedBearer = `Bearer ${options.secret}`;
      if (authHeader !== expectedBearer && authHeader !== options.secret) {
        return Response.json(
          { error: 'Unauthorized: Invalid email endpoint secret' },
          { status: 401, headers: corsHeaders }
        );
      }
    }

    // 2. Parse payload
    let payload: any;
    try {
      payload = await request.json();
    } catch {
      return Response.json(
        { error: 'Bad Request: Invalid JSON payload' },
        { status: 400, headers: corsHeaders }
      );
    }

    if (!payload || !payload.to || !payload.subject) {
      return Response.json(
        { error: "Bad Request: Fields 'to' and 'subject' are required." },
        { status: 400, headers: corsHeaders }
      );
    }

    if (!payload.from && options.defaultFrom) {
      payload.from = options.defaultFrom;
    }

    if (options.beforeSend) {
      const modified = await options.beforeSend(payload, request);
      if (modified) payload = modified;
    }

    // 3. Dispatch
    try {
      let result: any;
      if (options.dispatch) {
        result = await options.dispatch(payload, request);
      } else if (options.transport || (!options.provider && !options.apiKey)) {
        const { createNodemailerHandler } = await import('../email/index.js');
        const handler = createNodemailerHandler(options.transport || {}, {
          defaultFrom: options.defaultFrom,
        });
        result = await handler(payload, { id: 'srv-' + Date.now() } as any, {} as any);
      } else {
        const { createHttpEmailHandler } = await import('../email/index.js');
        const handler = createHttpEmailHandler({
          provider: options.provider as any,
          apiKey: options.apiKey,
          defaultFrom: options.defaultFrom,
        });
        result = await handler(payload, { id: 'srv-' + Date.now() } as any, {} as any);
      }

      const messageId = result?.messageId || result?.id || `msg-${Date.now()}`;
      return Response.json(
        { ok: true, id: messageId, result },
        { status: 200, headers: corsHeaders }
      );
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json(
        { error: 'Email dispatch failed: ' + message },
        { status: 500, headers: corsHeaders }
      );
    }
  };

  const handleOptions = async (): Promise<Response> => {
    return new Response(null, { status: 204, headers: corsHeaders });
  };

  return {
    POST: handlePost,
    OPTIONS: handleOptions,
  };
}

