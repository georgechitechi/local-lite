export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';

export * from './email.js';
export * from './sync.js';

export interface ApiRequestContext<TConfig = unknown> {
  request: Request;
  config: TConfig;
  path: string;
  params: Record<string, string>;
}

export type ApiHandler<TConfig = unknown> = (
  context: ApiRequestContext<TConfig>,
) => Response | Promise<Response>;

export type ApiMiddleware<TConfig = unknown> = (
  context: ApiRequestContext<TConfig>,
  next: () => Promise<Response>,
) => Response | Promise<Response>;

export type ApiEndpoint<TConfig = unknown> = Partial<Record<ApiMethod, ApiHandler<TConfig>>>;

export interface ServerConfig<TConfig = unknown> {
  /** Server-only services and provider configuration passed to endpoint handlers. */
  config: TConfig;
  /** Explicit endpoint map. Keys are URL patterns such as `/api/bookings/:bookingId`. */
  endpoints: Record<string, ApiEndpoint<TConfig>>;
  /** Middleware applied to every generated endpoint, in declaration order. */
  middleware?: ApiMiddleware<TConfig>[];
  /** Safe error hook for server-side reporting. Response details are not exposed to clients. */
  onError?: (error: unknown, context: ApiRequestContext<TConfig>) => void;
}

export type GeneratedApiHandlers = Record<string, Partial<Record<ApiMethod, (request: Request) => Promise<Response>>>>;

function normalizePath(path: string): string {
  const normalized = `/${path.split('/').filter(Boolean).join('/')}`;
  return normalized === '/' ? normalized : normalized.replace(/\/$/, '');
}

function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const patternSegments = normalizePath(pattern).split('/').filter(Boolean);
  const pathSegments = normalizePath(pathname).split('/').filter(Boolean);
  if (patternSegments.length !== pathSegments.length) return null;

  const params: Record<string, string> = {};
  for (let index = 0; index < patternSegments.length; index += 1) {
    const expected = patternSegments[index];
    const actual = pathSegments[index];
    if (expected.startsWith(':')) {
      try {
        params[expected.slice(1)] = decodeURIComponent(actual);
      } catch {
        return null;
      }
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}

function methodNotAllowed(methods: ApiMethod[]): Response {
  return Response.json(
    { error: 'Method Not Allowed' },
    { status: 405, headers: { Allow: methods.join(', ') } },
  );
}

/** Define and validate an app's server/API configuration. */
export function defineServerConfig<TConfig>(config: ServerConfig<TConfig>): ServerConfig<TConfig> {
  for (const [path, endpoint] of Object.entries(config.endpoints)) {
    if (!path.startsWith('/')) throw new TypeError(`API endpoint path must start with '/': ${path}`);
    if (!Object.values(endpoint).some(handler => typeof handler === 'function')) {
      throw new TypeError(`API endpoint '${path}' must define at least one method handler.`);
    }
  }
  return config;
}

/**
 * Build framework-neutral Request/Response handlers from one server config.
 * App route files can re-export a generated method handler, while tests and
 * custom servers can use `fetch()` as a single dispatcher.
 */
export function createServer<TConfig>(config: ServerConfig<TConfig>) {
  const definitions = Object.entries(config.endpoints).map(([path, endpoint]) => ({
    path: normalizePath(path),
    endpoint,
  }));

  const run = async (
    request: Request,
    pathPattern: string,
    endpoint: ApiEndpoint<TConfig>,
  ): Promise<Response> => {
    const method = request.method.toUpperCase() as ApiMethod;
    const url = new URL(request.url);
    const params = matchPath(pathPattern, url.pathname);
    const handler = endpoint[method];
    const context: ApiRequestContext<TConfig> = {
      request,
      config: config.config,
      path: pathPattern,
      params: params ?? {},
    };

    if (!params) return Response.json({ error: 'Not Found' }, { status: 404 });
    if (!handler) return methodNotAllowed(Object.keys(endpoint) as ApiMethod[]);

    const stack = config.middleware ?? [];
    let index = -1;
    const dispatch = async (position: number): Promise<Response> => {
      if (position <= index) throw new Error('API middleware called next() more than once.');
      index = position;
      const middleware = stack[position];
      if (!middleware) return await handler(context);
      return await middleware(context, () => dispatch(position + 1));
    };

    try {
      return await dispatch(0);
    } catch (error) {
      try {
        config.onError?.(error, context);
      } catch {
        // Reporting failures must not replace the original generic API response.
      }
      return Response.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  };

  const handlers: GeneratedApiHandlers = {};
  for (const { path, endpoint } of definitions) {
    handlers[path] = {};
    for (const method of Object.keys(endpoint) as ApiMethod[]) {
      handlers[path][method] = (request: Request) => run(request, path, endpoint);
    }
  }

  return {
    handlers,
    handler(path: string, method: ApiMethod) {
      const normalized = normalizePath(path);
      const definition = definitions.find(item => item.path === normalized);
      if (!definition || !definition.endpoint[method]) {
        throw new Error(`No ${method} API handler is configured for '${normalized}'.`);
      }
      return (request: Request) => run(request, definition.path, definition.endpoint);
    },
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const method = request.method.toUpperCase() as ApiMethod;
      let pathMatched = false;
      for (const definition of definitions) {
        if (!matchPath(definition.path, url.pathname)) continue;
        pathMatched = true;
        if (!definition.endpoint[method]) continue;
        return await run(request, definition.path, definition.endpoint);
      }
      if (pathMatched) {
        const allowed = definitions
          .filter(definition => matchPath(definition.path, url.pathname))
          .flatMap(definition => Object.keys(definition.endpoint) as ApiMethod[]);
        return methodNotAllowed([...new Set(allowed)]);
      }
      return Response.json({ error: 'Not Found' }, { status: 404 });
    },
  };
}
