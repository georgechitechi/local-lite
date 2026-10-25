import {
  AccessAction,
  AccessPolicyDefinition,
  AccessPredicate,
  AccessRule,
  AccessRuleBuilder,
  AccessSubject,
  RuleOptions,
  AccessEngine,
} from './types.js';
import { AccessGuard } from './guard.js';

class RuleBuilderImpl<TUser = any> implements AccessRuleBuilder<TUser> {
  public readonly rules: AccessRule<TUser>[] = [];

  private addRule(
    inverted: boolean,
    actions: AccessAction | AccessAction[],
    subjects: AccessSubject | AccessSubject[],
    arg3?: RuleOptions | AccessPredicate<any, TUser>,
    arg4?: AccessPredicate<any, TUser>
  ): this {
    const actionList = Array.isArray(actions) ? actions : [actions];
    const subjectList = Array.isArray(subjects) ? subjects : [subjects];

    let options: RuleOptions | undefined;
    let predicate: AccessPredicate<any, TUser> | undefined;

    if (typeof arg3 === 'function') {
      predicate = arg3;
    } else if (arg3 && typeof arg3 === 'object') {
      options = arg3;
      predicate = arg4;
    }

    this.rules.push({
      inverted,
      actions: actionList,
      subjects: subjectList,
      predicate,
      fields: options?.fields,
      description: options?.description,
    });

    return this;
  }

  can(
    action: AccessAction | AccessAction[],
    subject: AccessSubject | AccessSubject[],
    arg3?: RuleOptions | AccessPredicate<any, TUser>,
    arg4?: AccessPredicate<any, TUser>
  ): this {
    return this.addRule(false, action, subject, arg3, arg4);
  }

  cannot(
    action: AccessAction | AccessAction[],
    subject: AccessSubject | AccessSubject[],
    arg3?: RuleOptions | AccessPredicate<any, TUser>,
    arg4?: AccessPredicate<any, TUser>
  ): this {
    return this.addRule(true, action, subject, arg3, arg4);
  }
}

export function defineAccessRules<TUser = any>(
  policy: AccessPolicyDefinition<TUser>
): AccessEngine<TUser> {
  const createGuard = (user: TUser | null): AccessGuard<TUser> => {
    const builder = new RuleBuilderImpl<TUser>();
    policy(builder, user);
    return new AccessGuard<TUser>(user, builder.rules);
  };

  return {
    createGuard,
    for: createGuard,
  };
}
