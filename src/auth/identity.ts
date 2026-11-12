import { v5 as uuidv5 } from 'uuid';

export const DEFAULT_UNIFIED_EMAIL_NAMESPACE =
  '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

export type SupportedAuthProvider =
  'google' | 'github' | 'microsoft' | 'apple' | 'local';

/**
 * Standardized first-class user identity across all auth providers in local-lite.
 * Every provider client natively resolves and returns this canonical model.
 */
export interface AuthUser {
  /** Canonical deterministic UUID across all providers with the same verified email */
  id: string;
  /** Alias for id to ensure compatibility with session records and sync workers */
  userId: string;
  email: string;
  emailVerified: boolean;
  name: string;
  displayName: string;
  avatarUrl?: string | null;
  picture?: string | null;
  provider: SupportedAuthProvider;
  providerAccountId: string;
  rawProfile?: Record<string, any>;
  createdAt?: number;
}

export type UnifiedAuthUser = AuthUser;

export interface IdentityResolverOptions {
  namespace?: string;
  requireVerifiedEmail?: boolean;
}

/**
 * Resolves a canonical UUID for an incoming profile.
 * If email is verified, hashes the normalized email against the UUIDv5 namespace.
 * Falls back to provider-scoped deterministic ID if unverified or email is missing.
 */
export function resolveUnifiedUserId(
  profile: {
    id: string | number;
    email?: string | null;
    emailVerified?: boolean;
  },
  provider: SupportedAuthProvider,
  options?: IdentityResolverOptions,
): string {
  const ns = options?.namespace || DEFAULT_UNIFIED_EMAIL_NAMESPACE;
  const requireVerified = options?.requireVerifiedEmail ?? true;
  const isVerified = !requireVerified || profile.emailVerified === true;

  if (isVerified && profile.email && profile.email.trim().length > 0) {
    return uuidv5(profile.email.trim().toLowerCase(), ns);
  }

  return uuidv5(`${provider}:${profile.id}`, ns);
}

/**
 * Standardizes raw user records from Google, GitHub, Microsoft, Apple, or local auth
 * into a single unified user object with a canonical `id` / `userId`.
 */
export function createUnifiedAuthUser(
  rawUser: Record<string, any>,
  provider: SupportedAuthProvider,
  options?: IdentityResolverOptions,
): AuthUser {
  const emailRaw =
    typeof rawUser.email === 'string' ? rawUser.email : undefined;
  const email = emailRaw ? emailRaw.trim().toLowerCase() : '';
  const emailVerified =
    rawUser.emailVerified === true ||
    rawUser.email_verified === true ||
    provider === 'microsoft' ||
    provider === 'github';

  const providerAccountId = String(
    rawUser.providerAccountId ??
      rawUser.id ??
      rawUser.sub ??
      rawUser.userId ??
      '',
  );
  const id = resolveUnifiedUserId(
    { id: providerAccountId, email, emailVerified },
    provider,
    options,
  );

  const name =
    typeof rawUser.name === 'string' && rawUser.name.trim()
      ? rawUser.name.trim()
      : typeof rawUser.displayName === 'string' && rawUser.displayName.trim()
        ? rawUser.displayName.trim()
        : typeof rawUser.login === 'string'
          ? rawUser.login
          : email.split('@')[0] || 'User';

  const avatarUrl =
    typeof rawUser.picture === 'string'
      ? rawUser.picture
      : typeof rawUser.avatarUrl === 'string'
        ? rawUser.avatarUrl
        : typeof rawUser.avatar_url === 'string'
          ? rawUser.avatar_url
          : null;

  return {
    id,
    userId: id,
    email,
    emailVerified,
    name,
    displayName: name,
    avatarUrl,
    picture: avatarUrl,
    provider,
    providerAccountId,
    rawProfile: rawUser,
    createdAt:
      typeof rawUser.createdAt === 'number' ? rawUser.createdAt : Date.now(),
  };
}
