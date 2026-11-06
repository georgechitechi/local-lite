import { v5 as uuidv5 } from 'uuid';

export const DEFAULT_UNIFIED_EMAIL_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

export type SupportedAuthProvider = 'google' | 'github' | 'microsoft' | 'apple' | 'local';

export interface UnifiedAuthUser {
  /** Canonical deterministic UUID across all providers with the same verified email */
  userId: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  displayName?: string;
  avatarUrl?: string | null;
  provider: SupportedAuthProvider;
  providerAccountId: string;
  rawProfile: Record<string, any>;
  createdAt: number;
}

export interface IdentityResolverOptions {
  namespace?: string;
  requireVerifiedEmail?: boolean; // Defaults to true
}

/**
 * Resolves a canonical UUID for an incoming profile.
 * If email is verified, hashes the normalized email against the UUIDv5 namespace.
 * Falls back to provider-scoped deterministic ID if unverified or email is missing.
 */
export function resolveUnifiedUserId(
  profile: { id: string | number; email?: string | null; emailVerified?: boolean },
  provider: SupportedAuthProvider,
  options?: IdentityResolverOptions,
): string {
  const ns = options?.namespace || DEFAULT_UNIFIED_EMAIL_NAMESPACE;
  const requireVerified = options?.requireVerifiedEmail ?? true;
  const isVerified = !requireVerified || profile.emailVerified === true;

  if (isVerified && profile.email && profile.email.trim().length > 0) {
    return uuidv5(profile.email.trim().toLowerCase(), ns);
  }

  // Deterministic fallback for unverified or missing emails
  return uuidv5(`${provider}:${profile.id}`, ns);
}

/**
 * Standardizes raw user records from Google, GitHub, Microsoft, Apple, or local auth
 * into a single unified user object with a canonical `userId`.
 */
export function createUnifiedAuthUser(
  rawUser: Record<string, any>,
  provider: SupportedAuthProvider,
  options?: IdentityResolverOptions,
): UnifiedAuthUser {
  const emailRaw = typeof rawUser.email === 'string' ? rawUser.email : undefined;
  const email = emailRaw ? emailRaw.trim().toLowerCase() : '';
  const emailVerified =
    rawUser.emailVerified === true ||
    rawUser.email_verified === true ||
    provider === 'microsoft' || // Azure Graph returns primary user mail/UPN
    provider === 'github'; // GitHub emails returned from verified endpoint

  const providerAccountId = String(rawUser.id ?? rawUser.sub ?? rawUser.userId ?? '');
  const userId = resolveUnifiedUserId(
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
    userId,
    email,
    emailVerified,
    name,
    displayName: name,
    avatarUrl,
    provider,
    providerAccountId,
    rawProfile: rawUser,
    createdAt: Date.now(),
  };
}

