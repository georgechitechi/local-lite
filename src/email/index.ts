import type {
  Transporter,
  SendMailOptions,
  TransportOptions,
} from 'nodemailer';
import type {
  ActionHandlerContext,
  ActionRecord,
  EmailAttachment,
  EmailPayload,
} from '../actions/types.js';

import { safeDynamicImport } from '../utils/dynamic.js';

export type EmailProviderType =
  | 'nodemailer'
  | 'resend'
  | 'sendgrid'
  | 'postmark'
  | 'http'
  | 'dev'
  | 'preview'
  | 'custom';

export interface EmailHandlerOptions {
  /**
   * Default sender address (e.g. '"Support" <support@example.com>')
   * used when an enqueued email does not specify `from`.
   */
  defaultFrom?: string;

  /**
   * Additional default options merged into every outgoing email.
   */
  defaults?: Partial<SendMailOptions> & Record<string, any>;

  /**
   * Custom template renderer invoked when `template` or `templateData` is provided in EmailPayload.
   */
  renderTemplate?: (
    template: any,
    data: Record<string, any> | undefined,
    payload: EmailPayload,
  ) =>
    | Promise<{ html?: string; text?: string }>
    | { html?: string; text?: string };

  /**
   * Hook called before sending an email. Can inspect or modify outgoing options.
   */
  beforeSend?: (
    mailOptions: any,
    payload: EmailPayload,
    record: ActionRecord<EmailPayload>,
  ) => Promise<any | void> | any | void;

  /**
   * Hook called after an email has been successfully dispatched.
   */
  afterSend?: (
    result: any,
    payload: EmailPayload,
    record: ActionRecord<EmailPayload>,
  ) => Promise<void> | void;
}

export interface HttpEmailHandlerOptions extends EmailHandlerOptions {
  provider?: 'resend' | 'sendgrid' | 'postmark' | 'http' | 'custom';
  apiKey?: string;
  endpoint?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
}

export interface EmailDeliveryConfig extends EmailHandlerOptions {
  provider?: EmailProviderType;
  /** Nodemailer transporter instance, connection URL, or transport options */
  transport?: any;
  /** API key for HTTP services (Resend, SendGrid, Postmark) */
  apiKey?: string;
  /** Target endpoint for generic HTTP or webhook dispatch */
  endpoint?: string;
  /** Custom HTTP request headers */
  headers?: Record<string, string>;
  /** Custom fetch implementation */
  fetch?: typeof fetch;
  /** Silent dev mode logging */
  silentDev?: boolean;
}

export type NodemailerHandlerOptions = EmailHandlerOptions;
export type NodemailerTransportInput =
  Transporter | TransportOptions | string | any;

export interface EmailSendResult {
  messageId: string;
  response?: any;
  accepted?: Array<string | any>;
  rejected?: Array<string | any>;
  [key: string]: any;
}

export type NodemailerSendResult = EmailSendResult;

export type ConcreteEmailHandler = (
  payload: EmailPayload,
  record: ActionRecord<EmailPayload>,
  context: ActionHandlerContext,
) => Promise<EmailSendResult>;

export interface DevSentEmail {
  id: string;
  sentAt: number;
  mailOptions: SendMailOptions;
  payload: EmailPayload;
  record: ActionRecord<EmailPayload>;
}

/**
 * In-memory Dev Mailbox for inspecting locally dispatched emails during development.
 */
export class DevMailbox {
  private static inbox: DevSentEmail[] = [];

  static getInbox(): DevSentEmail[] {
    return [...this.inbox];
  }

  static getLatest(): DevSentEmail | undefined {
    return this.inbox[this.inbox.length - 1];
  }

  static clear(): void {
    this.inbox = [];
  }

  static record(email: DevSentEmail): void {
    this.inbox.push(email);
  }
}

/**
 * Dynamically loads the nodemailer module if not already available.
 */
export async function loadNodemailer(): Promise<any> {
  try {
    const mod = await import('nodemailer');
    return mod.default || mod;
  } catch (err: any) {
    throw new Error(
      "The 'nodemailer' package is required to send emails via Nodemailer transport. Please install it via 'npm install nodemailer'.",
    );
  }
}

/**
 * Resolves or instantiates a Nodemailer Transporter instance.
 */
export async function resolveTransporter(
  input: NodemailerTransportInput,
  defaults?: Partial<SendMailOptions>,
): Promise<Transporter> {
  if (input && typeof input.sendMail === 'function') {
    return input as Transporter;
  }
  const nm = await loadNodemailer();
  return nm.createTransport(input, defaults);
}

function interpolate(templateStr: string, data: Record<string, any>): string {
  return templateStr.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const val = data[key];
    return val !== undefined ? String(val) : '';
  });
}

/**
 * Renders a React element or JSX component into clean HTML and plaintext fallback.
 */
export async function renderReactEmail(
  element: any,
): Promise<{ html: string; text: string }> {
  if (!element) return { html: '', text: '' };

  const component = typeof element === 'function' ? element() : element;

  // 1. Try @react-email/render if installed
  try {
    const reactEmail = await safeDynamicImport('@react-email/render');
    const render = reactEmail?.render || reactEmail?.default?.render;
    if (typeof render === 'function') {
      const html = await render(component);
      const text = await render(component, { plainText: true });
      return { html, text };
    }
  } catch {}

  // 2. Try react-dom/server
  try {
    const ReactDOMServer = await safeDynamicImport('react-dom/server');
    const renderToStaticMarkup =
      ReactDOMServer?.renderToStaticMarkup ||
      ReactDOMServer?.default?.renderToStaticMarkup;
    if (typeof renderToStaticMarkup === 'function') {
      const html = renderToStaticMarkup(component);
      const text = html.replace(/<[^>]*>/g, '').trim();
      return { html, text };
    }
  } catch {}

  return { html: String(component), text: String(component) };
}

/**
 * Hydrates an attachment from a mobile file:// URI or local file path if possible.
 */
export async function hydrateAttachment(att: EmailAttachment): Promise<any> {
  const item: any = { filename: att.filename };
  if (att.contentType) item.contentType = att.contentType;
  if (att.content !== undefined) item.content = att.content;

  if (att.url) {
    const rawUrl = att.url;
    if (
      rawUrl.startsWith('file://') ||
      (!rawUrl.startsWith('http://') &&
        !rawUrl.startsWith('https://') &&
        !rawUrl.startsWith('data:'))
    ) {
      const filePath = rawUrl.startsWith('file://') ? rawUrl.slice(7) : rawUrl;
      try {
        const fs = await import('node:fs/promises');
        const buffer = await fs.readFile(filePath);
        item.content = buffer;
        return item;
      } catch {
        item.path = rawUrl;
        return item;
      }
    }
    item.path = rawUrl;
  }
  return item;
}

/**
 * Maps an offline Local-Lite EmailPayload to standard email options.
 */
export function buildMailOptions(
  payload: EmailPayload,
  options: EmailHandlerOptions = {},
): SendMailOptions {
  const mailOptions: SendMailOptions = {
    ...options.defaults,
    to: payload.to,
    subject: payload.subject,
    from: payload.from || options.defaultFrom || options.defaults?.from,
  };

  if (payload.text !== undefined) mailOptions.text = payload.text;
  if (payload.html !== undefined) mailOptions.html = payload.html;
  if (payload.cc !== undefined) mailOptions.cc = payload.cc;
  if (payload.bcc !== undefined) mailOptions.bcc = payload.bcc;
  if (payload.replyTo !== undefined) mailOptions.replyTo = payload.replyTo;

  if (payload.headers) {
    mailOptions.headers = {
      ...(typeof options.defaults?.headers === 'object'
        ? options.defaults.headers
        : {}),
      ...payload.headers,
    };
  }

  if (payload.attachments && payload.attachments.length > 0) {
    const existingAttachments = Array.isArray(options.defaults?.attachments)
      ? options.defaults!.attachments
      : [];
    const convertedAttachments = payload.attachments.map((att) => {
      const item: any = {
        filename: att.filename,
      };
      if (att.contentType) {
        item.contentType = att.contentType;
      }
      if (att.url) {
        item.path = att.url;
      }
      if (att.content !== undefined) {
        item.content = att.content;
      }
      return item;
    });
    mailOptions.attachments = [...existingAttachments, ...convertedAttachments];
  }

  return mailOptions;
}

async function prepareMailOptions(
  payload: EmailPayload,
  options: EmailHandlerOptions,
  record: ActionRecord<EmailPayload>,
): Promise<SendMailOptions> {
  let mailOptions = buildMailOptions(payload, options);

  // 1. React Email / JSX rendering support
  if (payload.react) {
    const rendered = await renderReactEmail(payload.react);
    mailOptions.html = rendered.html;
    if (!mailOptions.text && rendered.text) mailOptions.text = rendered.text;
  }

  // 2. Custom template rendering
  if (options.renderTemplate && (payload.template || payload.templateData)) {
    const rendered = await options.renderTemplate(
      payload.template,
      payload.templateData,
      payload,
    );
    if (rendered.html !== undefined) mailOptions.html = rendered.html;
    if (rendered.text !== undefined) mailOptions.text = rendered.text;
  } else if (payload.templateData) {
    if (typeof mailOptions.html === 'string') {
      mailOptions.html = interpolate(mailOptions.html, payload.templateData);
    }
    if (typeof mailOptions.text === 'string') {
      mailOptions.text = interpolate(mailOptions.text, payload.templateData);
    }
  }

  // 3. Auto-hydrate attachments (mobile file:// URIs)
  if (payload.attachments && payload.attachments.length > 0) {
    const hydrated = await Promise.all(
      payload.attachments.map((a) => hydrateAttachment(a)),
    );
    mailOptions.attachments = hydrated;
  }

  if (options.beforeSend) {
    const modified = await options.beforeSend(mailOptions, payload, record);
    if (modified) {
      mailOptions = modified;
    }
  }

  if (!mailOptions.to) {
    throw new Error("Recipient 'to' address is required to dispatch email.");
  }
  if (!mailOptions.from) {
    throw new Error(
      "Sender 'from' address is required to dispatch email. Provide 'from' in the email payload or set 'defaultFrom' in options.",
    );
  }

  return mailOptions;
}

/**
 * Creates an EmailHandler for local-lite ActionManager that sends emails
 * directly via Nodemailer (SMTP, Sendmail, SES, etc.).
 */
export function createNodemailerHandler(
  transporterOrOptions: NodemailerTransportInput,
  handlerOptions: NodemailerHandlerOptions = {},
): ConcreteEmailHandler {
  let cachedTransporter: Transporter | null =
    transporterOrOptions &&
    typeof (transporterOrOptions as any).sendMail === 'function'
      ? (transporterOrOptions as Transporter)
      : null;

  const getTransporter = async (): Promise<Transporter> => {
    if (!cachedTransporter) {
      cachedTransporter = await resolveTransporter(
        transporterOrOptions,
        handlerOptions.defaults,
      );
    }
    return cachedTransporter;
  };

  return async (
    payload: EmailPayload,
    record: ActionRecord<EmailPayload>,
    _context: ActionHandlerContext,
  ): Promise<EmailSendResult> => {
    const transporter = await getTransporter();
    const mailOptions = await prepareMailOptions(
      payload,
      handlerOptions,
      record,
    );

    const info = await transporter.sendMail(mailOptions);

    if (handlerOptions.afterSend) {
      await handlerOptions.afterSend(info, payload, record);
    }

    return {
      messageId: info.messageId,
      response: info.response,
      accepted: info.accepted,
      rejected: info.rejected,
    };
  };
}

/**
 * Creates an EmailHandler for local-lite ActionManager that dispatches emails
 * via HTTP APIs (e.g. Resend, SendGrid, Postmark, or custom webhooks/endpoints).
 */
export function createHttpEmailHandler(
  options: HttpEmailHandlerOptions,
): ConcreteEmailHandler {
  const fetchFn = options.fetch || globalThis.fetch;
  if (!fetchFn) {
    throw new Error(
      'A global or configured fetch function is required for HTTP email dispatch.',
    );
  }

  const provider = options.provider || 'http';

  return async (
    payload: EmailPayload,
    record: ActionRecord<EmailPayload>,
    _context: ActionHandlerContext,
  ): Promise<EmailSendResult> => {
    const mailOptions = await prepareMailOptions(payload, options, record);

    let url: string;
    let headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options.headers,
    };
    let body: any;

    if (provider === 'resend') {
      url = options.endpoint || 'https://api.resend.com/emails';
      if (options.apiKey) {
        headers['Authorization'] = `Bearer ${options.apiKey}`;
      }
      body = {
        from: mailOptions.from,
        to: mailOptions.to,
        subject: mailOptions.subject,
        html: mailOptions.html,
        text: mailOptions.text,
        cc: mailOptions.cc,
        bcc: mailOptions.bcc,
        reply_to: mailOptions.replyTo,
        headers: mailOptions.headers,
        attachments: mailOptions.attachments,
      };
    } else if (provider === 'sendgrid') {
      url = options.endpoint || 'https://api.sendgrid.com/v3/mail/send';
      if (options.apiKey) {
        headers['Authorization'] = `Bearer ${options.apiKey}`;
      }
      const toAddresses = Array.isArray(mailOptions.to)
        ? mailOptions.to
        : [mailOptions.to];
      const personalizations: any = {
        to: toAddresses.map((email: any) =>
          typeof email === 'string' ? { email } : email,
        ),
      };
      if (mailOptions.cc) {
        const ccAddresses = Array.isArray(mailOptions.cc)
          ? mailOptions.cc
          : [mailOptions.cc];
        personalizations.cc = ccAddresses.map((email: any) =>
          typeof email === 'string' ? { email } : email,
        );
      }
      if (mailOptions.bcc) {
        const bccAddresses = Array.isArray(mailOptions.bcc)
          ? mailOptions.bcc
          : [mailOptions.bcc];
        personalizations.bcc = bccAddresses.map((email: any) =>
          typeof email === 'string' ? { email } : email,
        );
      }

      const content: Array<{ type: string; value: string }> = [];
      if (mailOptions.text)
        content.push({ type: 'text/plain', value: String(mailOptions.text) });
      if (mailOptions.html)
        content.push({ type: 'text/html', value: String(mailOptions.html) });

      body = {
        personalizations: [personalizations],
        from:
          typeof mailOptions.from === 'string'
            ? { email: mailOptions.from }
            : mailOptions.from,
        subject: mailOptions.subject,
        content:
          content.length > 0 ? content : [{ type: 'text/plain', value: '' }],
      };
    } else if (provider === 'postmark') {
      url = options.endpoint || 'https://api.postmarkapp.com/email';
      if (options.apiKey) {
        headers['X-Postmark-Server-Token'] = options.apiKey;
      }
      body = {
        From: mailOptions.from,
        To: Array.isArray(mailOptions.to)
          ? mailOptions.to.join(',')
          : mailOptions.to,
        Subject: mailOptions.subject,
        HtmlBody: mailOptions.html,
        TextBody: mailOptions.text,
        Cc: Array.isArray(mailOptions.cc)
          ? mailOptions.cc.join(',')
          : mailOptions.cc,
        Bcc: Array.isArray(mailOptions.bcc)
          ? mailOptions.bcc.join(',')
          : mailOptions.bcc,
        ReplyTo: mailOptions.replyTo,
      };
    } else {
      url = options.endpoint || '/api/email';
      if (options.apiKey && !headers['Authorization']) {
        headers['Authorization'] = `Bearer ${options.apiKey}`;
      }
      body = {
        ...mailOptions,
        attachments: mailOptions.attachments,
        template: payload.template,
        templateData: payload.templateData,
      };
    }

    const response = await fetchFn(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      let errorText = '';
      try {
        errorText = await response.text();
      } catch {
        errorText = response.statusText;
      }
      throw new Error(
        `Email dispatch failed via HTTP (${response.status}): ${errorText}`,
      );
    }

    let resultData: any = {};
    try {
      resultData = await response.json();
    } catch {
      resultData = { ok: true, status: response.status };
    }

    const messageId =
      resultData.id ||
      resultData.messageId ||
      resultData.MessageID ||
      response.headers.get('x-message-id') ||
      `http-${record.id}`;

    const sendResult: EmailSendResult = {
      messageId,
      response: resultData,
      accepted: Array.isArray(mailOptions.to)
        ? mailOptions.to
        : [mailOptions.to],
    };

    if (options.afterSend) {
      await options.afterSend(sendResult, payload, record);
    }

    return sendResult;
  };
}

/**
 * Creates a local dev email handler that stores outgoing emails in DevMailbox
 * and logs an interactive terminal preview without sending real network requests.
 */
export function createDevEmailHandler(
  options: EmailHandlerOptions & { silent?: boolean } = {},
): ConcreteEmailHandler {
  return async (
    payload: EmailPayload,
    record: ActionRecord<EmailPayload>,
    _context: ActionHandlerContext,
  ): Promise<EmailSendResult> => {
    const mailOptions = await prepareMailOptions(payload, options, record);
    const sentRecord: DevSentEmail = {
      id: `dev-${record.id}`,
      sentAt: Date.now(),
      mailOptions,
      payload,
      record,
    };

    DevMailbox.record(sentRecord);

    if (!options.silent) {
      const toStr = Array.isArray(mailOptions.to)
        ? mailOptions.to.join(', ')
        : mailOptions.to;
      const previewText = (mailOptions.text || mailOptions.html || '')
        .toString()
        .slice(0, 120);
      console.log(
        `[local-lite:email:dev] Dispatched to: ${toStr} | Subject: "${mailOptions.subject}" | Body: "${previewText}"`,
      );
    }

    const result: EmailSendResult = {
      messageId: sentRecord.id,
      response: { dev: true, previewUrl: `dev://mailbox/${sentRecord.id}` },
      accepted: Array.isArray(mailOptions.to)
        ? mailOptions.to
        : [mailOptions.to],
    };

    if (options.afterSend) {
      await options.afterSend(result, payload, record);
    }

    return result;
  };
}

/**
 * Universal email handler factory that creates a dispatch handler
 * supporting Nodemailer (SMTP, Sendmail), HTTP providers (Resend, SendGrid, Postmark),
 * local dev mailbox, or custom webhooks.
 */
export function createEmailHandler(
  config: EmailDeliveryConfig,
): ConcreteEmailHandler {
  if (config.provider === 'dev' || config.provider === 'preview') {
    return createDevEmailHandler({ ...config, silent: config.silentDev });
  }

  if (config.transport || config.provider === 'nodemailer') {
    return createNodemailerHandler(config.transport || config, config);
  }

  if (
    config.provider === 'resend' ||
    config.provider === 'sendgrid' ||
    config.provider === 'postmark' ||
    config.provider === 'http' ||
    config.endpoint
  ) {
    return createHttpEmailHandler(config as HttpEmailHandlerOptions);
  }

  if (config.apiKey) {
    return createHttpEmailHandler({
      ...config,
      provider: 'resend',
    });
  }

  throw new Error(
    "Invalid email configuration: Provide 'transport' (for Nodemailer/SMTP), 'provider' ('resend'|'sendgrid'|'postmark'|'dev'), or 'endpoint' (for HTTP delivery).",
  );
}
