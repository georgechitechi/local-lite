import { GoogleAuthClient } from './google.js';
import { GitHubAuthClient } from './github.js';
import { MicrosoftAuthClient } from './microsoft.js';
import { AppleAuthClient } from './apple.js';
import { LocalAuthEngine } from './local.js';
import { SessionManager, SessionRecord } from './session.js';
import {
  SupportedAuthProvider,
  UnifiedAuthUser,
  createUnifiedAuthUser,
  DEFAULT_UNIFIED_EMAIL_NAMESPACE,
} from './identity.js';

export interface UnifiedAuthConfig {
  google?: GoogleAuthClient;
  github?: GitHubAuthClient;
  microsoft?: MicrosoftAuthClient;
  apple?: AppleAuthClient;
  local?: LocalAuthEngine;
  sessionManager?: SessionManager;
  /**
   * Whether to unify user identity across providers by verified email.
   * Default: true
   */
  unifyByEmail?: boolean;
  /**
   * Custom UUIDv5 namespace for deriving email-based user IDs.
   * Default: DEFAULT_UNIFIED_EMAIL_NAMESPACE ('6ba7b810-9dad-11d1-80b4-00c04fd430c8')
   */
  emailNamespace?: string;
}

export type AuthStateChangeListener = (user: UnifiedAuthUser | null) => void;

/**
 * High-level orchestrator that unifies multiple OAuth providers (Google, GitHub,
 * Microsoft, Apple) and local auth into a single consistent user identity model.
 */
export class UnifiedAuthManager {
  private google?: GoogleAuthClient;
  private github?: GitHubAuthClient;
  private microsoft?: MicrosoftAuthClient;
  private apple?: AppleAuthClient;
  private local?: LocalAuthEngine;
  private sessionManager?: SessionManager;
  private unifyByEmail: boolean;
  private emailNamespace?: string;
  private listeners = new Set<AuthStateChangeListener>();
  private unsubscribers: Array<() => void> = [];

  constructor(config: UnifiedAuthConfig) {
    this.google = config.google;
    this.github = config.github;
    this.microsoft = config.microsoft;
    this.apple = config.apple;
    this.local = config.local;
    this.sessionManager = config.sessionManager;
    this.unifyByEmail = config.unifyByEmail !== false;
    this.emailNamespace =
      config.emailNamespace || DEFAULT_UNIFIED_EMAIL_NAMESPACE;

    this.bindProviderListeners();
  }

  private bindProviderListeners() {
    if (this.google) {
      this.unsubscribers.push(
        this.google.onAuthStateChange((user) => {
          if (!user) return;
          const unified = createUnifiedAuthUser(user, 'google', {
            namespace: this.emailNamespace,
            requireVerifiedEmail: this.unifyByEmail,
          });
          this.notify(unified);
        }),
      );
    }
  }

  private notify(user: UnifiedAuthUser | null) {
    for (const listener of this.listeners) {
      try {
        listener(user);
      } catch (err) {
        console.warn('[UnifiedAuthManager] Error in auth state listener:', err);
      }
    }
  }

  /**
   * Subscribes to global unified authentication state changes.
   */
  onAuthStateChange(listener: AuthStateChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Authenticates using the specified provider and automatically establishes a unified session.
   */
  async signIn(
    provider: SupportedAuthProvider,
    credentials?: any,
  ): Promise<UnifiedAuthUser | null> {
    let rawUser: any = null;
    let token: string | null = null;
    let refreshToken: string | null = null;

    if (provider === 'google') {
      if (!this.google)
        throw new Error(
          'GoogleAuthClient is not configured on UnifiedAuthManager.',
        );
      rawUser = await this.google.signIn();
      token = await this.google.getValidAccessToken().catch(() => null);
    } else if (provider === 'github') {
      if (!this.github)
        throw new Error(
          'GitHubAuthClient is not configured on UnifiedAuthManager.',
        );
      rawUser = await this.github.signIn();
      token = await this.github.getValidAccessToken().catch(() => null);
    } else if (provider === 'microsoft') {
      if (!this.microsoft)
        throw new Error(
          'MicrosoftAuthClient is not configured on UnifiedAuthManager.',
        );
      rawUser = await this.microsoft.signIn();
      token = await this.microsoft.getValidAccessToken().catch(() => null);
    } else if (provider === 'apple') {
      if (!this.apple)
        throw new Error(
          'AppleAuthClient is not configured on UnifiedAuthManager.',
        );
      rawUser = await this.apple.signIn();
    } else if (provider === 'local') {
      if (!this.local)
        throw new Error(
          'LocalAuthEngine is not configured on UnifiedAuthManager.',
        );
      const identifier = credentials?.email || credentials?.identifier;
      const password = credentials?.password;
      if (!identifier || !password) {
        throw new Error(
          'Local authentication requires identifier/email and password credentials.',
        );
      }
      const result = await this.local.signIn({ identifier, password });
      rawUser = result.user;
    } else {
      throw new Error(`Unsupported auth provider: ${provider}`);
    }

    if (!rawUser) {
      return null;
    }

    const unifiedUser = createUnifiedAuthUser(rawUser, provider, {
      namespace: this.emailNamespace,
      requireVerifiedEmail: this.unifyByEmail,
    });

    if (this.sessionManager) {
      await this.sessionManager.createSession({
        userId: unifiedUser.userId,
        user: unifiedUser,
        provider,
        token,
        refreshToken,
      });
    }

    this.notify(unifiedUser);
    return unifiedUser;
  }

  /**
   * Retrieves the currently authenticated unified user.
   */
  async getUser(): Promise<UnifiedAuthUser | null> {
    if (this.sessionManager) {
      const session =
        await this.sessionManager.getActiveSession<UnifiedAuthUser>();
      if (session?.user) return session.user;
    }

    if (this.google && (await this.google.isSignedIn())) {
      const gUser = await this.google.getUser();
      if (gUser) {
        return createUnifiedAuthUser(gUser, 'google', {
          namespace: this.emailNamespace,
          requireVerifiedEmail: this.unifyByEmail,
        });
      }
    }

    return null;
  }

  /**
   * Retrieves the active SQLite session record.
   */
  async getSession(): Promise<SessionRecord<UnifiedAuthUser> | null> {
    if (!this.sessionManager) return null;
    return await this.sessionManager.getActiveSession<UnifiedAuthUser>();
  }

  /**
   * Checks whether there is an active session or signed-in provider.
   */
  async isAuthenticated(): Promise<boolean> {
    const user = await this.getUser();
    return user !== null;
  }

  /**
   * Signs out of the active session and all configured providers.
   */
  async signOut(): Promise<void> {
    if (this.sessionManager) {
      await this.sessionManager.clearSession();
    }
    await this.google?.signOut().catch(() => {});
    await this.github?.signOut().catch(() => {});
    await this.microsoft?.signOut().catch(() => {});
    await this.apple?.signOut().catch(() => {});
    this.notify(null);
  }

  /**
   * Cleans up all event listeners.
   */
  destroy(): void {
    for (const unsub of this.unsubscribers) {
      try {
        unsub();
      } catch {}
    }
    this.unsubscribers = [];
    this.listeners.clear();
  }
}
