import { AccessAction, AccessRule, AccessSubject } from './types.js';
import { AccessDeniedError } from './errors.js';

export class AccessGuard<TUser = any> {
  public readonly user: TUser | null;
  public readonly rules: AccessRule<TUser>[];

  constructor(user: TUser | null, rules: AccessRule<TUser>[]) {
    this.user = user;
    this.rules = rules;
  }

  /**
   * Evaluates if the current user has permission to perform an action on a subject.
   */
  can(action: AccessAction, subject: AccessSubject, record?: any): boolean {
    let allowed = false;

    for (const rule of this.rules) {
      const actionMatches =
        rule.actions.includes('manage') ||
        rule.actions.includes('all') ||
        rule.actions.includes(action);

      const subjectMatches =
        rule.subjects.includes('all') ||
        rule.subjects.includes(subject);

      if (!actionMatches || !subjectMatches) {
        continue;
      }

      if (rule.predicate) {
        try {
          if (!rule.predicate(record, this.user)) {
            continue;
          }
        } catch {
          continue;
        }
      }

      // If cannot rule matches (with no field filter), reject immediately
      if (rule.inverted && (!rule.fields || rule.fields.length === 0)) {
        return false;
      }

      // If can rule matches, mark allowed
      if (!rule.inverted) {
        allowed = true;
      }
    }

    return allowed;
  }

  cannot(action: AccessAction, subject: AccessSubject, record?: any): boolean {
    return !this.can(action, subject, record);
  }

  assertCan(action: AccessAction, subject: AccessSubject, record?: any): void {
    if (!this.can(action, subject, record)) {
      throw new AccessDeniedError({ action, subject, record });
    }
  }

  /**
   * Check if a specific field is accessible for an action.
   */
  canAccessField(action: AccessAction, subject: AccessSubject, field: string, record?: any): boolean {
    if (!this.can(action, subject, record)) {
      return false;
    }

    for (const rule of this.rules) {
      if (!rule.inverted || !rule.fields || !rule.fields.includes(field)) {
        continue;
      }

      const actionMatches =
        rule.actions.includes('manage') ||
        rule.actions.includes('all') ||
        rule.actions.includes(action);

      const subjectMatches =
        rule.subjects.includes('all') ||
        rule.subjects.includes(subject);

      if (actionMatches && subjectMatches) {
        if (!rule.predicate || rule.predicate(record, this.user)) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Strips restricted fields from an object based on rules.
   */
  filterAllowedFields<T extends Record<string, any>>(
    action: AccessAction,
    subject: AccessSubject,
    data: T,
    record?: any
  ): Partial<T> {
    if (!data || typeof data !== 'object') return data;
    const result: Record<string, any> = {};

    for (const [key, value] of Object.entries(data)) {
      if (this.canAccessField(action, subject, key, record || data)) {
        result[key] = value;
      }
    }

    return result as Partial<T>;
  }

  /**
   * Filters an array of rows, removing unauthorized records and stripping forbidden fields.
   */
  filterRows<T extends Record<string, any>>(
    action: AccessAction,
    subject: AccessSubject,
    rows: T[]
  ): T[] {
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((row) => this.can(action, subject, row))
      .map((row) => this.filterAllowedFields(action, subject, row, row) as T);
  }
}
