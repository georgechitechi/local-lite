export type AccessAction =
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'manage'
  | (string & {});

export type AccessSubject = 'all' | (string & {});

export type AccessPredicate<TRecord = any, TUser = any> = (
  record?: TRecord,
  user?: TUser | null
) => boolean;

export interface RuleOptions {
  fields?: string[];
  description?: string;
}

export interface AccessRule<TUser = any> {
  inverted: boolean; // false = can, true = cannot
  actions: string[];
  subjects: string[];
  predicate?: AccessPredicate<any, TUser>;
  fields?: string[];
  description?: string;
}

export interface AccessRuleBuilder<TUser = any> {
  can(
    action: AccessAction | AccessAction[],
    subject: AccessSubject | AccessSubject[],
    predicate?: AccessPredicate<any, TUser>
  ): this;
  can(
    action: AccessAction | AccessAction[],
    subject: AccessSubject | AccessSubject[],
    options: RuleOptions,
    predicate?: AccessPredicate<any, TUser>
  ): this;

  cannot(
    action: AccessAction | AccessAction[],
    subject: AccessSubject | AccessSubject[],
    predicate?: AccessPredicate<any, TUser>
  ): this;
  cannot(
    action: AccessAction | AccessAction[],
    subject: AccessSubject | AccessSubject[],
    options: RuleOptions,
    predicate?: AccessPredicate<any, TUser>
  ): this;
}

export type AccessPolicyDefinition<TUser = any> = (
  builder: AccessRuleBuilder<TUser>,
  user: TUser | null
) => void;

export interface AccessEngine<TUser = any> {
  createGuard(user: TUser | null): any;
  for(user: TUser | null): any;
}
