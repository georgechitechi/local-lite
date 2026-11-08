import { describe, it, expect, vi } from 'vitest';
import {
  defineServerConfig,
  createServer,
  ServerConfig,
  ApiRequestContext,
} from '../src/server/index.js';

describe('Server & API Router (src/server/index.ts)', () => {
  describe('defineServerConfig', () => {
    it('accepts and returns valid server configurations', () => {
      const config: ServerConfig = {
        config: { dbUrl: 'sqlite://mem' },
        endpoints: {
          '/api/health': {
            GET: () => Response.json({ status: 'ok' }),
          },
        },
      };

      const result = defineServerConfig(config);
      expect(result).toBe(config);
    });

    it('throws TypeError when an endpoint path does not begin with /', () => {
      const config: ServerConfig = {
        config: {},
        endpoints: {
          'api/health': {
            GET: () => Response.json({ ok: true }),
          },
        },
      };

      expect(() => defineServerConfig(config)).toThrowError(
        "API endpoint path must start with '/': api/health",
      );
    });

    it('throws TypeError when an endpoint defines no method handlers', () => {
      const config: ServerConfig = {
        config: {},
        endpoints: {
          '/api/empty': {},
        },
      };

      expect(() => defineServerConfig(config)).toThrowError(
        "API endpoint '/api/empty' must define at least one method handler.",
      );
    });
  });

  describe('createServer', () => {
    it('generates handlers map for registered routes and methods', async () => {
      const server = createServer({
        config: { app: 'test-app' },
        endpoints: {
          '/api/users': {
            GET: (ctx) => Response.json({ users: ['Alice', 'Bob'] }),
            POST: async (ctx) => {
              const body = await ctx.request.json();
              return Response.json({ created: body.name }, { status: 201 });
            },
          },
        },
      });

      expect(server.handlers['/api/users']).toBeDefined();
      expect(server.handlers['/api/users'].GET).toBeDefined();
      expect(server.handlers['/api/users'].POST).toBeDefined();

      const getReq = new Request('http://localhost:3000/api/users', { method: 'GET' });
      const getRes = await server.handlers['/api/users'].GET!(getReq);
      expect(getRes.status).toBe(200);
      expect(await getRes.json()).toEqual({ users: ['Alice', 'Bob'] });

      const postReq = new Request('http://localhost:3000/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Charlie' }),
      });
      const postRes = await server.handlers['/api/users'].POST!(postReq);
      expect(postRes.status).toBe(201);
      expect(await postRes.json()).toEqual({ created: 'Charlie' });
    });

    it('retrieves specific handler with server.handler()', async () => {
      const server = createServer({
        config: {},
        endpoints: {
          '/api/ping': {
            GET: () => new Response('pong'),
          },
        },
      });

      const getPing = server.handler('/api/ping', 'GET');
      const res = await getPing(new Request('http://localhost/api/ping'));
      expect(await res.text()).toBe('pong');

      expect(() => server.handler('/api/ping', 'POST')).toThrowError(
        "No POST API handler is configured for '/api/ping'.",
      );
      expect(() => server.handler('/api/missing', 'GET')).toThrowError(
        "No GET API handler is configured for '/api/missing'.",
      );
    });

    describe('server.fetch unified dispatcher', () => {
      const server = createServer({
        config: { env: 'testing' },
        endpoints: {
          '/api/items': {
            GET: () => Response.json([{ id: 1, title: 'Item 1' }]),
            POST: () => Response.json({ created: true }, { status: 201 }),
          },
          '/api/items/:id': {
            GET: (ctx) => Response.json({ id: ctx.params.id }),
            DELETE: (ctx) => Response.json({ deleted: ctx.params.id }),
          },
          '/api/categories/:cat/items/:sub': {
            GET: (ctx) =>
              Response.json({
                category: ctx.params.cat,
                sub: ctx.params.sub,
              }),
          },
        },
      });

      it('routes requests and decodes URL parameters correctly', async () => {
        const res = await server.fetch(
          new Request('http://localhost/api/items/42', { method: 'GET' }),
        );
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ id: '42' });

        const delRes = await server.fetch(
          new Request('http://localhost/api/items/item%2099', { method: 'DELETE' }),
        );
        expect(delRes.status).toBe(200);
        expect(await delRes.json()).toEqual({ deleted: 'item 99' });

        const multiParamRes = await server.fetch(
          new Request('http://localhost/api/categories/electronics/items/phones'),
        );
        expect(await multiParamRes.json()).toEqual({
          category: 'electronics',
          sub: 'phones',
        });
      });

      it('returns 404 for unmatched routes', async () => {
        const res = await server.fetch(new Request('http://localhost/api/unknown-route'));
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: 'Not Found' });
      });

      it('returns 405 Method Not Allowed with Allow header when path exists but method does not', async () => {
        const res = await server.fetch(
          new Request('http://localhost/api/items', { method: 'DELETE' }),
        );
        expect(res.status).toBe(405);
        expect(res.headers.get('Allow')).toBe('GET, POST');
        expect(await res.json()).toEqual({ error: 'Method Not Allowed' });
      });
    });

    describe('Middleware Pipeline & Error Handling', () => {
      it('executes middleware stack in declaration order and attaches context', async () => {
        const log: string[] = [];

        const server = createServer({
          config: { apiKey: 'secret' },
          middleware: [
            async (ctx, next) => {
              log.push('m1-before');
              const res = await next();
              log.push('m1-after');
              res.headers.set('X-Custom-M1', 'true');
              return res;
            },
            async (ctx, next) => {
              log.push('m2-before');
              const res = await next();
              log.push('m2-after');
              return res;
            },
          ],
          endpoints: {
            '/api/test': {
              GET: (ctx) => {
                log.push(`handler-${ctx.config.apiKey}`);
                return Response.json({ success: true });
              },
            },
          },
        });

        const res = await server.fetch(new Request('http://localhost/api/test'));
        expect(res.status).toBe(200);
        expect(res.headers.get('X-Custom-M1')).toBe('true');
        expect(log).toEqual(['m1-before', 'm2-before', 'handler-secret', 'm2-after', 'm1-after']);
      });

      it('allows middleware to short-circuit the request (e.g. auth check)', async () => {
        const server = createServer({
          config: {},
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
            '/api/protected': {
              GET: () => Response.json({ data: 'confidential' }),
            },
          },
        });

        // 1. Without auth
        const unauthRes = await server.fetch(new Request('http://localhost/api/protected'));
        expect(unauthRes.status).toBe(401);
        expect(await unauthRes.json()).toEqual({ error: 'Unauthorized' });

        // 2. With auth
        const authRes = await server.fetch(
          new Request('http://localhost/api/protected', {
            headers: { Authorization: 'Bearer token123' },
          }),
        );
        expect(authRes.status).toBe(200);
        expect(await authRes.json()).toEqual({ data: 'confidential' });
      });

      it('prevents multiple calls to next() in middleware', async () => {
        const server = createServer({
          config: {},
          middleware: [
            async (ctx, next) => {
              await next();
              return await next(); // Illegal second call
            },
          ],
          endpoints: {
            '/api/buggy': {
              GET: () => Response.json({ ok: true }),
            },
          },
        });

        const res = await server.fetch(new Request('http://localhost/api/buggy'));
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ error: 'Internal Server Error' });
      });

      it('calls onError hook and returns 500 when handler throws an unhandled error', async () => {
        let reportedError: any = null;
        let reportedContext: ApiRequestContext | null = null;

        const server = createServer({
          config: { service: 'payments' },
          onError: (err, ctx) => {
            reportedError = err;
            reportedContext = ctx;
          },
          endpoints: {
            '/api/crash': {
              GET: () => {
                throw new Error('Database connection crashed');
              },
            },
          },
        });

        const res = await server.fetch(new Request('http://localhost/api/crash'));
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ error: 'Internal Server Error' });
        expect(reportedError).toBeInstanceOf(Error);
        expect(reportedError.message).toBe('Database connection crashed');
        expect((reportedContext as ApiRequestContext | null)?.path).toBe('/api/crash');
      });

      it('silently ignores exceptions thrown within onError itself without masking 500', async () => {
        const server = createServer({
          config: {},
          onError: () => {
            throw new Error('Reporting service Sentry down');
          },
          endpoints: {
            '/api/fail': {
              GET: () => {
                throw new Error('Handler fail');
              },
            },
          },
        });

        const res = await server.fetch(new Request('http://localhost/api/fail'));
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ error: 'Internal Server Error' });
      });
    });
  });
});

