# Server API Routing

`local-lite/server` creates framework-neutral `Request`/`Response` API handlers from one server configuration. Define route paths, methods, app services, and optional middleware once, then export generated handlers from your framework's route files or use the single `fetch()` dispatcher.

The server module does not choose or create a database client. Pass server-side services for the configured backend (for example, a Supabase or Convex adapter) through `config`. Keep provider selection consistent with the backend used by `local-lite` sync. Never pass a device's SQLite client or mobile-only configuration to a server handler.

## Define server configuration

```ts
// src/server/api.ts
import { createServer, defineServerConfig } from 'local-lite/server';

interface AppServerConfig {
  bookings: {
    create(input: Record<string, unknown>): Promise<{ id: string }>;
    get(id: string): Promise<Record<string, unknown> | null>;
  };
  verifyApiKey(request: Request): Promise<boolean>;
}

const config = defineServerConfig<AppServerConfig>({
  // Inject backend-specific server services. Keep secrets on the server.
  config: createConfiguredBackendServices(),
  middleware: [async ({ request, config }, next) => {
    if (!await config.verifyApiKey(request)) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return next();
  }],
  endpoints: {
    '/api/bookings': {
      POST: async ({ request, config }) => {
        const input = await request.json();
        const booking = await config.bookings.create(input);
        return Response.json({ success: true, ...booking }, { status: 201 });
      },
    },
    '/api/bookings/:bookingId': {
      GET: async ({ params, config }) => {
        const booking = await config.bookings.get(params.bookingId);
        if (!booking) return Response.json({ error: 'Not Found' }, { status: 404 });
        return Response.json(booking);
      },
    },
  },
  onError(error, context) {
    // Report details to server logs/telemetry; responses remain generic.
    console.error('API request failed', context.path, error);
  },
});

export const apiServer = createServer(config);
```

`createConfiguredBackendServices()` above is app-owned: it should select the server adapter using the same explicit provider setting as sync and provide only the operations the routes need. Do not silently fall back to another backend when the selected provider is unavailable.

## Export generated handlers from route files

A framework route can export a generated handler for its method and path:

```ts
// app/api/bookings/index+api.ts (Expo Router API route)
import { apiServer } from '@/server/api';

export const POST = apiServer.handler('/api/bookings', 'POST');
```

```ts
// app/api/bookings/[bookingId]+api.ts
import { apiServer } from '@/server/api';

export const GET = apiServer.handler('/api/bookings/:bookingId', 'GET');
```

`handler(path, method)` throws during setup if that endpoint is not configured, so route configuration mistakes are caught early. Generated handlers receive the original `Request`; dynamic path segments are decoded into `params`.

## Use a single dispatcher

For a server runtime that mounts one catch-all handler, `fetch()` matches the URL path and method against the configured routes:

```ts
import { apiServer } from './api';

export const GET = (request: Request) => apiServer.fetch(request);
export const POST = (request: Request) => apiServer.fetch(request);
```

Unknown paths return `404`; paths with no configured method return `405` and an `Allow` header. Unhandled endpoint or middleware errors are reported to `onError` and return a generic `500` response.

## Middleware

Middleware runs in declaration order and can authenticate, add request-level checks, or short-circuit with a response. Call `next()` exactly once to continue. Put route-specific authorization and input validation in the endpoint or a narrowly scoped middleware; registering an endpoint does not itself grant access to its data.

## API reference

- `defineServerConfig(config)` validates the endpoint map and preserves its configuration type.
- `createServer(config)` returns `handlers`, `handler(path, method)`, and `fetch(request)`.
- Endpoint context contains `request`, `config`, normalized `path`, and decoded `params`.
- Supported methods: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, and `OPTIONS`.

The package centralizes route registration and handler generation. Apps still define their endpoint behavior, authorization rules, provider adapters, and response contracts.
