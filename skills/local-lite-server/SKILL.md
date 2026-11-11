---
name: local-lite-server
description: Configure and implement framework-neutral REST API routing, turnkey self-hosted sync endpoints, and email dispatch endpoints with local-lite/server. Use when setting up server endpoints (defineServerConfig, createServer, createSyncEndpoint, createEmailEndpoint), declaring route parameters, implementing middleware pipelines, managing HTTP methods (GET, POST, PUT, DELETE, OPTIONS), 405 Method Not Allowed handling, or dispatching single fetch() requests in Edge, Node, Next.js, or Expo Router API routes.
---

# local-lite Server API Routing

Guide for building framework-neutral REST API handlers, route parameters, middleware pipelines, and request dispatchers using `local-lite/server`.

---

## 1. Overview

`local-lite/server` provides a lightweight, framework-agnostic HTTP routing layer using standard Web `Request` and `Response` objects. It is designed for:
* **Expo Router API Routes** (`app/api/...index+api.ts`)
* **Next.js App Router Route Handlers** (`app/api/.../route.ts`)
* **Cloudflare Workers / Edge / Node.js** standalone HTTP servers
* **Integration Tests** using single-call `server.fetch(request)` dispatchers

---

## 2. Defining Server Configuration (`defineServerConfig`)

```typescript
// src/server/api.ts
import { defineServerConfig, createServer } from 'local-lite/server';

interface AppServerServices {
  apiKey: string;
  db: any;
}

const config = defineServerConfig<AppServerServices>({
  config: {
    apiKey: process.env.API_SECRET_KEY!,
    db: myBackendDbClient,
  },
  // Middleware executes sequentially in declaration order
  middleware: [
    async (ctx, next) => {
      const authHeader = ctx.request.headers.get('Authorization');
      if (!authHeader) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }
      return await next();
    },
  ],
  endpoints: {
    '/api/tasks': {
      GET: async (ctx) => {
        const tasks = await ctx.config.db.query('SELECT * FROM tasks');
        return Response.json({ tasks });
      },
      POST: async (ctx) => {
        const body = await ctx.request.json();
        const created = await ctx.config.db.insert('tasks', body);
        return Response.json(created, { status: 201 });
      },
    },
    '/api/tasks/:taskId': {
      GET: async (ctx) => {
        const task = await ctx.config.db.getById('tasks', ctx.params.taskId);
        if (!task) {
          return Response.json({ error: 'Task not found' }, { status: 404 });
        }
        return Response.json(task);
      },
      DELETE: async (ctx) => {
        await ctx.config.db.delete('tasks', ctx.params.taskId);
        return Response.json({ success: true });
      },
    },
  },
  onError(error, context) {
    // Report internal server errors safely to telemetry without leaking stack trace to clients
    console.error(`[Server Error] ${context.path}:`, error);
  },
});

export const apiServer = createServer(config);
```

---

## 3. Mounting in Framework Route Handlers

### In Expo Router (`app/api/tasks+api.ts`):
```typescript
import { apiServer } from '@/server/api';

export const GET = apiServer.handler('/api/tasks', 'GET');
export const POST = apiServer.handler('/api/tasks', 'POST');
```

### In Dynamic Expo Router Routes (`app/api/tasks/[taskId]+api.ts`):
```typescript
import { apiServer } from '@/server/api';

export const GET = apiServer.handler('/api/tasks/:taskId', 'GET');
export const DELETE = apiServer.handler('/api/tasks/:taskId', 'DELETE');
```

---

## 4. Single `fetch()` Dispatcher

For platforms mounting a single catch-all handler (Cloudflare Workers, Hono, Node.js HTTP server):

```typescript
import { apiServer } from './api';

export default {
  async fetch(request: Request): Promise<Response> {
    return await apiServer.fetch(request);
  },
};
```

---

## 5. Built-in Behaviors

* **Path Matching & Parameters**: Segments prefixed with `:` (e.g. `:taskId`) are automatically extracted and URL-decoded into `ctx.params`.
* **Method Not Allowed (405)**: If a route exists for `GET` but receives a `DELETE`, it automatically returns status `405` with an RFC-compliant `Allow: GET` header.
* **Not Found (404)**: Unmatched paths return a standardized `{ error: 'Not Found' }` with status `404`.
* **Safe Error Handling (500)**: Unhandled errors in middleware or endpoints trigger `onError` server-side and return `{ error: 'Internal Server Error' }` without exposing internal implementation details.

---

## 6. Turnkey Self-Hosted Sync Endpoint (`createSyncEndpoint`)

Zero-boilerplate multi-device synchronization endpoint replacing third-party backends (Supabase, Convex, Firebase):

```typescript
import { defineServerConfig, createServer, createSyncEndpoint, MemoryServerSyncStorage } from 'local-lite/server';

export const apiServer = createServer(
  defineServerConfig({
    config: {},
    endpoints: {
      // Mount turnkey sync endpoint (POST for push/batch, GET for pull)
      '/api/sync': createSyncEndpoint({
        secret: process.env.SYNC_SECRET_TOKEN,
        storage: new MemoryServerSyncStorage(), // Or persistent database storage
      }),
    },
  })
);
```

Clients connect to this simply by setting `server: { url: 'https://api.domain.com/api/sync', token: '...' }` in `defineSyncConfig`.

---

## 7. Turnkey Email Relay Endpoint (`createEmailEndpoint`)

Mount a pre-built email endpoint that receives offline-queued emails from mobile/Expo apps and sends them via Nodemailer or cloud providers:

```typescript
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

