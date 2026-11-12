import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import nodemailer from 'nodemailer';
import { LocalFirstClient } from '../src/core/client.js';
import { MemoryDemoRemoteAdapter } from '../src/adapters/remote/demo.js';
import { DefaultNetworkStatusProvider } from '../src/adapters/network/index.js';
import { MockDB } from './helpers/mock-db.js';
import {
  createHttpEmailHandler,
  buildMailOptions,
} from '../src/email/index.js';
import {
  createNodemailerHandler,
  resolveTransporter,
} from '../src/server/email.js';
import { createSyncClient } from '../src/config/index.js';

describe('Unified Email Module (Nodemailer & HTTP Providers)', () => {
  let db: MockDB;
  let remote: MemoryDemoRemoteAdapter;
  let network: DefaultNetworkStatusProvider;
  let client: LocalFirstClient;

  beforeEach(async () => {
    db = new MockDB();
    remote = new MemoryDemoRemoteAdapter(50);
    network = new DefaultNetworkStatusProvider(true);

    client = new LocalFirstClient({
      local: db,
      remote,
      network,
      pushIntervalMs: 500,
      pullIntervalMs: 1000,
    });

    await client.initialize();
  });

  afterEach(() => {
    client.stop();
  });

  describe('Nodemailer Engine', () => {
    it('buildMailOptions maps EmailPayload correctly', () => {
      const payload = {
        to: 'recipient@example.com',
        from: 'sender@example.com',
        subject: 'Hello from Local-Lite',
        text: 'Plain text body',
        html: '<p>HTML body</p>',
        cc: 'team@example.com',
        bcc: 'archive@example.com',
        replyTo: 'reply@example.com',
        headers: { 'X-Custom-Header': 'val-123' },
        attachments: [
          {
            filename: 'doc.pdf',
            url: 'https://example.com/doc.pdf',
            contentType: 'application/pdf',
          },
          { filename: 'note.txt', content: 'hello file' },
        ],
      };

      const options = buildMailOptions(payload, {
        defaultFrom: 'default@example.com',
      });

      expect(options.to).toBe('recipient@example.com');
      expect(options.from).toBe('sender@example.com');
      expect(options.subject).toBe('Hello from Local-Lite');
      expect(options.text).toBe('Plain text body');
      expect(options.html).toBe('<p>HTML body</p>');
      expect(options.cc).toBe('team@example.com');
      expect(options.bcc).toBe('archive@example.com');
      expect(options.replyTo).toBe('reply@example.com');
      expect(options.headers).toEqual({ 'X-Custom-Header': 'val-123' });
      expect(options.attachments).toHaveLength(2);
      expect(options.attachments?.[0]).toEqual({
        filename: 'doc.pdf',
        path: 'https://example.com/doc.pdf',
        contentType: 'application/pdf',
      });
      expect(options.attachments?.[1]).toEqual({
        filename: 'note.txt',
        content: 'hello file',
      });
    });

    it('resolves transporter from existing transporter or options object', async () => {
      const existing = nodemailer.createTransport({ jsonTransport: true });
      expect(await resolveTransporter(existing)).toBe(existing);

      const created = await resolveTransporter({ jsonTransport: true });
      expect(typeof created.sendMail).toBe('function');
    });

    it('dispatches enqueued email directly via Nodemailer without Convex or remote adapters', async () => {
      const transporter = nodemailer.createTransport({ jsonTransport: true });

      client.actions.registerEmailHandler(
        createNodemailerHandler(transporter, {
          defaultFrom: 'noreply@locallite.dev',
        }),
      );

      const action = await client.actions.sendEmail({
        to: 'user@example.com',
        subject: 'Offline First Email',
        html: '<h1>Welcome!</h1>',
        text: 'Welcome!',
      });

      expect(action.status).toBe('PENDING');

      const flushResult = await client.actions.flush();
      expect(flushResult.completed).toBe(1);
      expect(flushResult.failed).toBe(0);

      const record = await client.actions.get(action.id);
      expect(record?.status).toBe('COMPLETED');
      expect(record?.executedAt).toBeGreaterThan(0);
      expect(record?.result?.messageId).toBeDefined();
    });

    it('interpolates templateData into html and text', async () => {
      let sentMail: any = null;
      const transporter = nodemailer.createTransport({ jsonTransport: true });
      const originalSendMail = transporter.sendMail.bind(transporter);
      vi.spyOn(transporter, 'sendMail').mockImplementation(async (mail) => {
        sentMail = mail;
        return originalSendMail(mail);
      });

      client.actions.registerEmailHandler(
        createNodemailerHandler(transporter, {
          defaultFrom: 'noreply@locallite.dev',
        }),
      );

      await client.actions.sendEmail({
        to: 'alice@example.com',
        subject: 'Order Confirmation',
        text: 'Hello {{name}}, your total is {{total}} USD.',
        html: '<p>Hello {{name}}, your total is <b>{{total}} USD</b>.</p>',
        templateData: { name: 'Alice', total: '99' },
      });

      await client.actions.flush();

      expect(sentMail).not.toBeNull();
      expect(sentMail.text).toBe('Hello Alice, your total is 99 USD.');
      expect(sentMail.html).toBe(
        '<p>Hello Alice, your total is <b>99 USD</b>.</p>',
      );
    });

    it('supports custom renderTemplate hook', async () => {
      let sentMail: any = null;
      const transporter = nodemailer.createTransport({ jsonTransport: true });
      vi.spyOn(transporter, 'sendMail').mockImplementation(async (mail) => {
        sentMail = mail;
        return { messageId: 'custom-render-id' } as any;
      });

      client.actions.registerEmailHandler(
        createNodemailerHandler(transporter, {
          defaultFrom: 'noreply@locallite.dev',
          renderTemplate: async (template, data) => {
            if (template === 'welcome_v2') {
              return {
                html: `<div>Custom rendered welcome for ${data?.user}</div>`,
                text: `Custom rendered welcome for ${data?.user}`,
              };
            }
            return {};
          },
        }),
      );

      await client.actions.sendEmail({
        to: 'bob@example.com',
        subject: 'Welcome V2',
        template: 'welcome_v2',
        templateData: { user: 'Bob' },
      });

      await client.actions.flush();

      expect(sentMail.html).toBe('<div>Custom rendered welcome for Bob</div>');
      expect(sentMail.text).toBe('Custom rendered welcome for Bob');
    });

    it('calls beforeSend and afterSend lifecycle hooks', async () => {
      let beforeCalled = false;
      let afterCalled = false;

      const transporter = nodemailer.createTransport({ jsonTransport: true });

      client.actions.registerEmailHandler(
        createNodemailerHandler(transporter, {
          defaultFrom: 'noreply@locallite.dev',
          beforeSend: (mail) => {
            beforeCalled = true;
            mail.headers = { ...mail.headers, 'X-Trace-Id': 'trace-1234' };
            return mail;
          },
          afterSend: (info) => {
            afterCalled = true;
            expect(info.messageId).toBeDefined();
          },
        }),
      );

      await client.actions.sendEmail({
        to: 'charlie@example.com',
        subject: 'Hook Test',
        text: 'Testing lifecycle hooks',
      });

      await client.actions.flush();

      expect(beforeCalled).toBe(true);
      expect(afterCalled).toBe(true);
    });

    it('retries failed sends up to maxRetries before marking FAILED', async () => {
      const failingTransporter = {
        sendMail: vi
          .fn()
          .mockRejectedValue(
            new Error('SMTP Connection Refused (ECONNREFUSED)'),
          ),
      };

      client.actions.registerEmailHandler(
        createNodemailerHandler(failingTransporter as any, {
          defaultFrom: 'noreply@locallite.dev',
        }),
      );

      const action = await client.actions.sendEmail({
        to: 'fail@example.com',
        subject: 'Will Fail',
        text: 'Trying to send...',
        maxRetries: 2,
      });

      // 1st attempt
      await client.actions.flush();
      let record = await client.actions.get(action.id);
      expect(record?.status).toBe('PENDING');
      expect(record?.retryCount).toBe(1);
      expect(record?.lastError).toContain('ECONNREFUSED');

      // 2nd attempt (final failure)
      await client.actions.flush();
      record = await client.actions.get(action.id);
      expect(record?.status).toBe('FAILED');
      expect(record?.retryCount).toBe(2);
    });
  });

  describe('HTTP Engine (Resend, SendGrid, Postmark, Generic HTTP)', () => {
    it('dispatches to Resend API correctly', async () => {
      let capturedUrl = '';
      let capturedOptions: any = null;

      const mockFetch = vi.fn().mockImplementation(async (url, opts) => {
        capturedUrl = String(url);
        capturedOptions = opts;
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'resend-msg-123' }),
        };
      });

      client.actions.registerEmailHandler(
        createHttpEmailHandler({
          provider: 'resend',
          apiKey: 're_test_key_123',
          defaultFrom: 'onboarding@resend.dev',
          fetch: mockFetch as any,
        }),
      );

      const action = await client.actions.sendEmail({
        to: 'customer@acme.com',
        subject: 'Order Complete',
        html: '<p>Thanks!</p>',
      });

      const flushResult = await client.actions.flush();
      expect(flushResult.completed).toBe(1);

      expect(capturedUrl).toBe('https://api.resend.com/emails');
      expect(capturedOptions.headers['Authorization']).toBe(
        'Bearer re_test_key_123',
      );
      const body = JSON.parse(capturedOptions.body);
      expect(body.to).toBe('customer@acme.com');
      expect(body.from).toBe('onboarding@resend.dev');
      expect(body.subject).toBe('Order Complete');

      const record = await client.actions.get(action.id);
      expect(record?.status).toBe('COMPLETED');
      expect(record?.result?.messageId).toBe('resend-msg-123');
    });

    it('dispatches to SendGrid API correctly', async () => {
      let capturedOptions: any = null;

      const mockFetch = vi.fn().mockImplementation(async (url, opts) => {
        capturedOptions = opts;
        return {
          ok: true,
          status: 202,
          json: async () => ({}),
        };
      });

      client.actions.registerEmailHandler(
        createHttpEmailHandler({
          provider: 'sendgrid',
          apiKey: 'SG.test_key',
          defaultFrom: 'mailer@company.com',
          fetch: mockFetch as any,
        }),
      );

      await client.actions.sendEmail({
        to: ['user1@company.com', 'user2@company.com'],
        subject: 'Security Alert',
        text: 'New sign in detected',
      });

      await client.actions.flush();

      expect(capturedOptions.headers['Authorization']).toBe(
        'Bearer SG.test_key',
      );
      const body = JSON.parse(capturedOptions.body);
      expect(body.personalizations[0].to).toEqual([
        { email: 'user1@company.com' },
        { email: 'user2@company.com' },
      ]);
      expect(body.from).toEqual({ email: 'mailer@company.com' });
      expect(body.subject).toBe('Security Alert');
    });

    it('dispatches to Postmark API correctly', async () => {
      let capturedOptions: any = null;

      const mockFetch = vi.fn().mockImplementation(async (url, opts) => {
        capturedOptions = opts;
        return {
          ok: true,
          status: 200,
          json: async () => ({ MessageID: 'postmark-abc' }),
        };
      });

      client.actions.registerEmailHandler(
        createHttpEmailHandler({
          provider: 'postmark',
          apiKey: 'postmark-token-xyz',
          defaultFrom: 'alerts@domain.com',
          fetch: mockFetch as any,
        }),
      );

      await client.actions.sendEmail({
        to: 'boss@domain.com',
        subject: 'Weekly Report',
        html: '<p>Report details...</p>',
      });

      await client.actions.flush();

      expect(capturedOptions.headers['X-Postmark-Server-Token']).toBe(
        'postmark-token-xyz',
      );
      const body = JSON.parse(capturedOptions.body);
      expect(body.From).toBe('alerts@domain.com');
      expect(body.To).toBe('boss@domain.com');
      expect(body.Subject).toBe('Weekly Report');
      expect(body.HtmlBody).toBe('<p>Report details...</p>');
    });

    it('dispatches to generic HTTP webhook', async () => {
      let capturedUrl = '';
      let capturedBody: any = null;

      const mockFetch = vi.fn().mockImplementation(async (url, opts) => {
        capturedUrl = String(url);
        capturedBody = JSON.parse(opts.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'webhook-999' }),
        };
      });

      client.actions.registerEmailHandler(
        createHttpEmailHandler({
          endpoint: 'https://internal.corp/api/email/dispatch',
          headers: { 'X-Secret': 'secret-token' },
          defaultFrom: 'corp@internal.net',
          fetch: mockFetch as any,
        }),
      );

      await client.actions.sendEmail({
        to: 'emp@internal.net',
        subject: 'Internal Update',
        text: 'System update tonight',
      });

      await client.actions.flush();

      expect(capturedUrl).toBe('https://internal.corp/api/email/dispatch');
      expect(capturedBody.to).toBe('emp@internal.net');
      expect(capturedBody.from).toBe('corp@internal.net');
    });
  });

  describe('createSyncClient config.email auto-wiring', () => {
    it('rejects Nodemailer transport in the client entry point', async () => {
      const testTransporter = nodemailer.createTransport({
        jsonTransport: true,
      });

      await expect(createSyncClient({
        database: db,
        inMemoryRemote: true,
        email: {
          transport: testTransporter,
          defaults: {
            from: '"Auto App" <auto@example.com>',
          },
        },
      })).rejects.toThrow('Nodemailer email delivery is server-only');
    });

    it('automatically wires HTTP provider (e.g. Resend) via createSyncClient', async () => {
      let capturedUrl = '';
      const mockFetch = vi.fn().mockImplementation(async (url) => {
        capturedUrl = String(url);
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'resend-auto-123' }),
        };
      });

      const syncClient = await createSyncClient({
        database: db,
        inMemoryRemote: true,
        email: {
          provider: 'resend',
          apiKey: 're_secret_123',
          defaults: {
            from: 'noreply@mybrand.com',
          },
          options: {
            fetch: mockFetch,
          },
        },
      });

      await syncClient.actions.sendEmail({
        to: 'user@mybrand.com',
        subject: 'Welcome to My Brand',
        html: '<p>Welcome!</p>',
      });

      const flushResult = await syncClient.actions.flush();
      expect(flushResult.completed).toBe(1);
      expect(capturedUrl).toBe('https://api.resend.com/emails');

      syncClient.stop();
    });
  });
});
