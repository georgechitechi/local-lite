import { describe, it, expect, beforeEach } from 'vitest';
import { createEmailEndpoint } from '../src/server/email.js';
import { createServer, defineServerConfig } from '../src/server/index.js';
import { ActionManager } from '../src/actions/manager.js';
import { MockDB } from './helpers/mock-db.js';
import { EventEmitter } from '../src/reactive/event-emitter.js';
import {
  DevMailbox,
  createEmailHandler,
  renderReactEmail,
  hydrateAttachment,
} from '../src/email/index.js';

describe('Advanced Email, Server Endpoints & Action Features', () => {
  describe('createEmailEndpoint', () => {
    it('creates a working HTTP email endpoint with authentication and CORS', async () => {
      let dispatchedPayload: any = null;

      const endpoint = createEmailEndpoint({
        secret: 'super-secret-token',
        dispatch: async (payload) => {
          dispatchedPayload = payload;
          return { messageId: 'srv-msg-777' };
        },
      });

      const server = createServer(
        defineServerConfig({
          config: {},
          endpoints: {
            '/api/send-email': endpoint,
          },
        }),
      );

      // 1. Unauthorized request
      const unauthReq = new Request('http://localhost:3000/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: 'user@test.com', subject: 'Hi' }),
      });
      const unauthRes = await server.fetch(unauthReq);
      expect(unauthRes.status).toBe(401);

      // 2. Authorized request
      const authReq = new Request('http://localhost:3000/api/send-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer super-secret-token',
        },
        body: JSON.stringify({
          to: 'customer@test.com',
          subject: 'Receipt #99',
          html: '<p>Payment complete</p>',
        }),
      });

      const authRes = await server.fetch(authReq);
      expect(authRes.status).toBe(200);
      const authData = await authRes.json();
      expect(authData.ok).toBe(true);
      expect(authData.id).toBe('srv-msg-777');
      expect(dispatchedPayload.to).toBe('customer@test.com');
      expect(dispatchedPayload.subject).toBe('Receipt #99');

      // 3. CORS OPTIONS preflight
      const optionsReq = new Request('http://localhost:3000/api/send-email', {
        method: 'OPTIONS',
      });
      const optionsRes = await server.fetch(optionsReq);
      expect(optionsRes.status).toBe(204);
      expect(optionsRes.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });

  describe('Rate Limiting & Concurrency in ActionManager', () => {
    let db: MockDB;
    let events: EventEmitter;

    beforeEach(async () => {
      db = new MockDB();
      events = new EventEmitter();
    });

    it('enforces rate limiting across flushed actions', async () => {
      const manager = new ActionManager(db, events, async () => true, {
        rateLimit: { max: 2, windowMs: 100 },
      });
      await manager.initialize();

      const timestamps: number[] = [];
      manager.registerHandler('rate_limited', async () => {
        timestamps.push(Date.now());
      });

      await manager.enqueue({ action: 'rate_limited', payload: 1 });
      await manager.enqueue({ action: 'rate_limited', payload: 2 });
      await manager.enqueue({ action: 'rate_limited', payload: 3 });

      const start = Date.now();
      const res = await manager.flush();
      expect(res.completed).toBe(3);
      // Because max: 2 per 100ms, the 3rd execution must have delayed by >= 90ms
      expect(Date.now() - start).toBeGreaterThanOrEqual(90);
    });

    it('executes actions in parallel when concurrency > 1', async () => {
      const manager = new ActionManager(db, events, async () => true, {
        concurrency: 3,
      });
      await manager.initialize();

      let activeWorkers = 0;
      let peakConcurrency = 0;

      manager.registerHandler('parallel_task', async () => {
        activeWorkers++;
        peakConcurrency = Math.max(peakConcurrency, activeWorkers);
        await new Promise((r) => setTimeout(r, 40));
        activeWorkers--;
      });

      await manager.enqueue({
        action: 'parallel_task',
        payload: { item: 'a' },
      });
      await manager.enqueue({
        action: 'parallel_task',
        payload: { item: 'b' },
      });
      await manager.enqueue({
        action: 'parallel_task',
        payload: { item: 'c' },
      });

      const res = await manager.flush();
      expect(res.completed).toBe(3);
      expect(peakConcurrency).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Type-Safe Action Contracts (defineAction)', () => {
    it('validates schema before inserting action into outbox', async () => {
      const db = new MockDB();
      const events = new EventEmitter();
      const manager = new ActionManager(db, events, async () => true);
      await manager.initialize();

      manager.defineAction({
        name: 'create_invoice',
        schema: (payload: any) => {
          if (!payload.amount || payload.amount <= 0) {
            throw new Error('Amount must be positive');
          }
          return payload;
        },
      });

      // Should fail schema validation
      await expect(
        manager.enqueue({
          action: 'create_invoice',
          payload: { amount: -50 },
        }),
      ).rejects.toThrow('Amount must be positive');

      // Should succeed when valid
      const validAction = await manager.enqueue({
        action: 'create_invoice',
        payload: { amount: 150 },
      });
      expect(validAction.id).toBeDefined();
      expect(validAction.payload.amount).toBe(150);
    });
  });

  describe('DevMailbox & In-Memory Mode', () => {
    it('captures outgoing emails in DevMailbox without real network requests', async () => {
      DevMailbox.clear();
      const handler = createEmailHandler({
        provider: 'dev',
        silentDev: true,
      });

      const res = await handler(
        {
          to: 'dev@test.local',
          from: 'app@test.local',
          subject: 'Dev Test Email',
          text: 'Inspect me in memory',
        },
        { id: 'act-123' } as any as any,
        {} as any,
      );

      expect(res?.messageId).toContain('dev-act-123');
      expect(DevMailbox.getInbox()).toHaveLength(1);
      const latest = DevMailbox.getLatest();
      expect(latest?.payload.to).toBe('dev@test.local');
      expect(latest?.payload.subject).toBe('Dev Test Email');
    });
  });

  describe('React Email & JSX Rendering', () => {
    it('renders component element to clean HTML and text', async () => {
      const mockElement = () => '<p>Hello from JSX</p>';
      const rendered = await renderReactEmail(mockElement);
      expect(rendered.html).toContain('Hello from JSX');
    });
  });

  describe('Mobile Attachment Hydration', () => {
    it('preserves existing attachments and handles file path normalization', async () => {
      const att = {
        filename: 'photo.jpg',
        url: 'https://cdn.example.com/photo.jpg',
      };
      const hydrated = await hydrateAttachment(att);
      expect(hydrated.filename).toBe('photo.jpg');
      expect(hydrated.path).toBe('https://cdn.example.com/photo.jpg');
    });
  });
});
