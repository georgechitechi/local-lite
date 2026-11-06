import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveUnifiedUserId,
  createUnifiedAuthUser,
  DEFAULT_UNIFIED_EMAIL_NAMESPACE,
  UnifiedAuthManager,
  SessionManager,
  GoogleAuthClient,
  GitHubAuthClient,
} from '../src/index.js';
import { MockDB } from './helpers/mock-db.js';

describe('User Identity Unification (local-lite/auth)', () => {
  const email = 'georgechitechi@gmail.com';

  describe('resolveUnifiedUserId', () => {
    it('generates identical canonical userId across Google, GitHub, and Microsoft for the same verified email', () => {
      const googleId = resolveUnifiedUserId(
        { id: 'google_sub_1092830192', email, emailVerified: true },
        'google'
      );
      const githubId = resolveUnifiedUserId(
        { id: 4829104, email, emailVerified: true },
        'github'
      );
      const msId = resolveUnifiedUserId(
        { id: 'ms-guid-839210-abcdef', email, emailVerified: true },
        'microsoft'
      );

      expect(googleId).toBeDefined();
      expect(googleId).toBe(githubId);
      expect(googleId).toBe(msId);
    });

    it('normalizes email case and whitespace', () => {
      const id1 = resolveUnifiedUserId(
        { id: '1', email: '  GeorgeChitechi@Gmail.COM  ', emailVerified: true },
        'google'
      );
      const id2 = resolveUnifiedUserId(
        { id: '2', email: 'georgechitechi@gmail.com', emailVerified: true },
        'github'
      );

      expect(id1).toBe(id2);
    });

    it('falls back to provider-scoped deterministic ID when email is unverified or missing', () => {
      const unverifiedGoogle = resolveUnifiedUserId(
        { id: 'user_123', email: 'unverified@test.com', emailVerified: false },
        'google'
      );
      const unverifiedGithub = resolveUnifiedUserId(
        { id: 'user_123', email: 'unverified@test.com', emailVerified: false },
        'github'
      );

      expect(unverifiedGoogle).not.toBe(unverifiedGithub);
    });
  });

  describe('createUnifiedAuthUser', () => {
    it('creates standardized unified user models with canonical userId', () => {
      const rawGoogle = {
        sub: 'google_sub_123',
        email,
        email_verified: true,
        name: 'George Chitechi',
        picture: 'https://example.com/photo.jpg',
      };

      const rawGithub = {
        id: 998877,
        login: 'georgechitechi',
        email,
        name: 'George Chitechi',
        avatar_url: 'https://github.com/avatar.png',
      };

      const unifiedGoogle = createUnifiedAuthUser(rawGoogle, 'google');
      const unifiedGithub = createUnifiedAuthUser(rawGithub, 'github');

      expect(unifiedGoogle.userId).toBe(unifiedGithub.userId);
      expect(unifiedGoogle.email).toBe('georgechitechi@gmail.com');
      expect(unifiedGithub.email).toBe('georgechitechi@gmail.com');
      expect(unifiedGoogle.provider).toBe('google');
      expect(unifiedGithub.provider).toBe('github');
      expect(unifiedGoogle.providerAccountId).toBe('google_sub_123');
      expect(unifiedGithub.providerAccountId).toBe('998877');
    });
  });

  describe('SessionManager Multi-Provider Linking', () => {
    let db: MockDB;
    let sessionManager: SessionManager;

    beforeEach(async () => {
      db = new MockDB();
      sessionManager = new SessionManager(db);
      await sessionManager.initialize();
    });

    it('links sessions under the same canonical userId in SQLite without creating duplicate records', async () => {
      const canonicalId = resolveUnifiedUserId({ id: '1', email, emailVerified: true }, 'google');

      // 1. First sign-in via Google
      const s1 = await sessionManager.createSession({
        userId: canonicalId,
        user: { name: 'George', email, provider: 'google' },
        provider: 'google',
        token: 'google_access_token_123',
      });

      expect(s1.userId).toBe(canonicalId);
      expect(s1.token).toBe('google_access_token_123');

      // 2. Later sign-in via GitHub with the same email
      const s2 = await sessionManager.createSession({
        userId: canonicalId,
        user: { name: 'George', email, provider: 'github' },
        provider: 'github',
        token: 'github_access_token_456',
      });

      // Same canonical session reused and updated
      expect(s2.id).toBe(s1.id);
      expect(s2.userId).toBe(canonicalId);
      expect(s2.token).toBe('github_access_token_456');

      const active = await sessionManager.getActiveSession();
      expect(active?.userId).toBe(canonicalId);
      expect(active?.token).toBe('github_access_token_456');

      const byUserId = await sessionManager.getSessionByUserId(canonicalId);
      expect(byUserId?.id).toBe(s1.id);
    });
  });

  describe('UnifiedAuthManager', () => {
    let db: MockDB;
    let sessionManager: SessionManager;

    beforeEach(async () => {
      db = new MockDB();
      sessionManager = new SessionManager(db);
      await sessionManager.initialize();
    });

    it('orchestrates login and exposes canonical user identity', async () => {
      let googleSignedIn = false;
      let githubSignedIn = false;

      const mockGoogleClient = {
        signIn: async () => {
          googleSignedIn = true;
          return { id: 'sub_123', email, emailVerified: true, name: 'George' };
        },
        getValidAccessToken: async () => 'mock_google_token',
        isSignedIn: async () => googleSignedIn,
        getUser: async () => (googleSignedIn ? { id: 'sub_123', email, emailVerified: true, name: 'George' } : null),
        signOut: async () => {
          googleSignedIn = false;
        },
        onAuthStateChange: () => () => {},
      } as unknown as GoogleAuthClient;

      const mockGitHubClient = {
        signIn: async () => {
          githubSignedIn = true;
          return { id: 'gh_456', email, name: 'George' };
        },
        getValidAccessToken: async () => 'mock_github_token',
        isSignedIn: async () => githubSignedIn,
        getUser: async () => (githubSignedIn ? { id: 'gh_456', email, name: 'George' } : null),
        signOut: async () => {
          githubSignedIn = false;
        },
        onAuthStateChange: () => () => {},
      } as unknown as GitHubAuthClient;

      const authManager = new UnifiedAuthManager({
        google: mockGoogleClient,
        github: mockGitHubClient,
        sessionManager,
      });

      let notifiedUser: any = null;
      authManager.onAuthStateChange(u => {
        notifiedUser = u;
      });

      // Login with Google
      const googleUser = await authManager.signIn('google');
      expect(googleUser?.userId).toBeDefined();
      expect(notifiedUser?.userId).toBe(googleUser?.userId);

      // Login with GitHub
      const githubUser = await authManager.signIn('github');
      expect(githubUser?.userId).toBe(googleUser?.userId);
      expect(notifiedUser?.userId).toBe(googleUser?.userId);

      expect(await authManager.isAuthenticated()).toBe(true);

      // Sign out
      await authManager.signOut();
      expect(await authManager.isAuthenticated()).toBe(false);
      expect(notifiedUser).toBeNull();
    });
  });
});
