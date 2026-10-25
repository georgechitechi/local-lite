export class AccessDeniedError extends Error {
  public readonly action: string;
  public readonly subject: string;
  public readonly fields?: string[];
  public readonly record?: any;
  public readonly reason?: string;

  constructor(options: {
    action: string;
    subject: string;
    fields?: string[];
    record?: any;
    reason?: string;
  }) {
    const fieldsText = options.fields && options.fields.length > 0 ? ` (fields: ${options.fields.join(', ')})` : '';
    const message =
      options.reason ||
      `Access denied: cannot perform action '${options.action}' on subject '${options.subject}'${fieldsText}.`;
    super(message);
    this.name = 'AccessDeniedError';
    this.action = options.action;
    this.subject = options.subject;
    this.fields = options.fields;
    this.record = options.record;
    this.reason = options.reason;
  }
}
