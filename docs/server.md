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

## Turnkey Server Endpoints

`local-lite/server` provides pre-built, turnkey endpoints for self-hosted database synchronization and offline-enqueued email dispatching.

### 1. Turnkey Self-Hosted Sync Endpoint (`createSyncEndpoint`)

Mount an out-of-the-box sync backend endpoint supporting push, pull, delta tracking, and Last-Write-Wins conflict resolution—with zero external cloud services required:

```ts
import { createServer, defineServerConfig, createSyncEndpoint, MemoryServerSyncStorage } from 'local-lite/server';

export const apiServer = createServer(
  defineServerConfig({
    config: {},
    endpoints: {
      '/api/sync': createSyncEndpoint({
        secret: process.env.SYNC_SECRET_TOKEN,
        storage: new MemoryServerSyncStorage(), // Or persistent storage (MySQL / PostgreSQL)
      }),
    },
  })
);
```

Connect mobile and web clients simply by setting `server: { url: 'https://api.domain.com/api/sync', token: '...' }` in `defineSyncConfig`.

#### Production Database Storage (MySQL Recipe)

For persistent production storage, implement `ServerSyncStorage` using MySQL (`mysql2/promise`):

```sql
-- MySQL Change Log Table
CREATE TABLE IF NOT EXISTS _server_changes (
  cursor BIGINT AUTO_INCREMENT PRIMARY KEY,
  table_name VARCHAR(128) NOT NULL,
  row_id VARCHAR(64) NOT NULL,
  payload JSON NOT NULL,
  operation VARCHAR(32) NOT NULL,
  timestamp BIGINT NOT NULL,
  INDEX idx_cursor (cursor),
  INDEX idx_table (table_name)
) ENGINE=InnoDB;
```

```ts
// app/api/sync+api.ts (Expo Router) or src/server/sync.ts
import mysql from 'mysql2/promise';
import {
  createServer,
  defineServerConfig,
  createSyncEndpoint,
  type ServerSyncStorage,
} from 'local-lite/server';

const pool = mysql.createPool({
  uri: process.env.DATABASE_URL,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

const mysqlStorage: ServerSyncStorage = {
  async applyOperations(operations, serverTime = Date.now()) {
    const conn = await pool.getConnection();
    const successfulIds: string[] = [];
    let applied = 0;

    try {
      await conn.beginTransaction();
      for (const op of operations) {
        if (!op.tableName || !op.rowId) continue;
        const opTime = op.timestamp || serverTime;

        // Append to the monotonic delta log
        await conn.execute(
          `INSERT INTO _server_changes (table_name, row_id, payload, operation, timestamp)
           VALUES (?, ?, ?, ?, ?)`,
          [op.tableName, String(op.rowId), JSON.stringify(op.payload || {}), op.operation, opTime]
        );
        successfulIds.push(op.id);
        applied++;
      }

      const [cursorRows]: any = await conn.query(
        'SELECT COALESCE(MAX(`cursor`), 0) AS max_cursor FROM _server_changes'
      );
      await conn.commit();

      return {
        applied,
        successfulIds,
        serverTime,
        cursor: Number(cursorRows[0]?.max_cursor || 0),
      };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  async getDeltas(tables, since, limit = 200) {
    if (tables.length === 0) {
      return {
        changes: { timestamp: Date.now(), changes: [] },
        cursor: since,
        hasMore: false,
        serverTime: Date.now(),
      };
    }

    const placeholders = tables.map(() => '?').join(',');
    const [rows]: any = await pool.query(
      `SELECT * FROM _server_changes
       WHERE \`cursor\` > ? AND table_name IN (${placeholders})
       ORDER BY \`cursor\` ASC LIMIT ?`,
      [since, ...tables, Number(limit)]
    );

    const changes = {
      timestamp: Date.now(),
      changes: rows.map((r: any) => ({
        tableName: r.table_name,
        rowId: r.row_id,
        operation: r.operation,
        payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload,
        timestamp: Number(r.timestamp),
      })),
    };

    const maxCursor = rows.length > 0 ? Number(rows[rows.length - 1].cursor) : since;
    return {
      changes,
      cursor: maxCursor,
      hasMore: rows.length === Number(limit),
      serverTime: Date.now(),
    };
  },
};

export const apiServer = createServer(
  defineServerConfig({
    config: {},
    endpoints: {
      '/api/sync': createSyncEndpoint({
        storage: mysqlStorage,
        secret: process.env.SYNC_SECRET_TOKEN,
      }),
    },
  })
);

// Export route handlers for Expo Router or Next.js App Router
export const POST = apiServer.handler('/api/sync', 'POST');
export const GET = apiServer.handler('/api/sync', 'GET');
export const OPTIONS = apiServer.handler('/api/sync', 'OPTIONS');
```

### 2. Turnkey Email Relay Endpoint (`createEmailEndpoint`)

Mount a pre-configured email relay endpoint that receives offline-queued emails from mobile devices and dispatches them via Nodemailer or cloud providers:

```ts
import { createServer, defineServerConfig, createEmailEndpoint } from 'local-lite/server';

export const apiServer = createServer(
  defineServerConfig({
    config: {},
    endpoints: {
      '/api/send-email': createEmailEndpoint({
        secret: process.env.EMAIL_API_SECRET,
        transport: {
          host: 'smtp.mailgun.org',
          port: 587,
          auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        },
        defaultFrom: '"My App" <noreply@myapp.com>',
      }),
    },
  })
);
```

## API reference

- `defineServerConfig(config)` validates the endpoint map and preserves its configuration type.
- `createServer(config)` returns `handlers`, `handler(path, method)`, and `fetch(request)`.
- Endpoint context contains `request`, `config`, normalized `path`, and decoded `params`.
- Supported methods: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, and `OPTIONS`.

The package centralizes route registration and handler generation. Apps still define their endpoint behavior, authorization rules, provider adapters, and response contracts.
