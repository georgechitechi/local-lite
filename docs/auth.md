# 🔑 Authentication (Local SQLite, Google, Microsoft / OneDrive, GitHub & Apple)

`local-lite` provides zero-backend, PKCE-secured authentication clients and React hooks out of the box for the four most popular identity providers, plus a **fully local SQLite authentication engine**:
* **Local SQLite Auth Engine** (`LocalAuthEngine`, `useLocalAuth`) — 100% offline, PBKDF2-SHA256 password crypto, account lockout, tokens, and users table
* **Multi-Provider Identity Unification** (`UnifiedAuthManager`) — Links local and OAuth identities by verified email into a canonical deterministic `userId`
* **Google** (`GoogleAuthClient`, `useGoogleAuth`)
* **Microsoft / OneDrive** (`MicrosoftAuthClient`, `OneDriveAuthClient`, `useMicrosoftAuth`, `useOneDriveAuth`)
* **GitHub** (`GitHubAuthClient`, `useGitHubAuth`)
* **Apple** (`AppleAuthClient`, `useAppleAuth`)

Built specifically for local-first architectures, these clients allow your Expo, React Native, Web, or Desktop application to authenticate users directly without requiring an intermediate backend auth server.

```typescript
import {
  GoogleAuthClient,
  MicrosoftAuthClient,
  OneDriveAuthClient,
  GitHubAuthClient,
  AppleAuthClient,
} from 'local-lite/auth';

import {
  useGoogleAuth,
  useMicrosoftAuth,
  useOneDriveAuth,
  useGitHubAuth,
  useAppleAuth,
} from 'local-lite/react';
```

---

## 🌟 Common Architecture & Security

* **🛡️ PKCE Security (RFC 7636):** Automatic cryptographically secure 32-byte `code_verifier`, SHA-256 (`S256`) code challenge generation, and CSRF state validation.
* **👤 Direct Profile Fetching:** Retrieves verified user profile (`id`, `name`, `email`, `picture`) directly from the provider's standard UserInfo / Graph / API endpoints.
* **🔄 Transparent Token Refreshing:** Inspects token expiration and uses `refresh_token` automatically when within 60 seconds of expiry.
* **💾 Pluggable Storage:** Use in-memory stores by default or pass any key-value storage adapter (AsyncStorage, SQLite kv-store, SecureStore, etc.) to keep sessions across app restarts.
* **⚛️ Reactive React Hooks:** Hooks provide reactive user state, sign-in, sign-out, and auto-subscriptions.

---

## 1. Google Authentication

### Setup in Expo / React Native:
```typescript
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { GoogleAuthClient, createGoogleAuthTokenStore } from 'local-lite/auth';

export const googleAuth = new GoogleAuthClient({
  clientId: 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com',
  redirectUri: Linking.createURL('oauth'),
  scopes: ['openid', 'email', 'profile'],
  authorize: async ({ authorizationUrl, redirectUri }) => {
    const result = await WebBrowser.openAuthSessionAsync(authorizationUrl, redirectUri);
    if (result.type !== 'success' || !result.url) return null;
    const url = new URL(result.url);
    return {
      code: url.searchParams.get('code') ?? '',
      state: url.searchParams.get('state') ?? '',
    };
  },
});
```

---

## 2. Microsoft & OneDrive Authentication

The Microsoft Identity Platform (v2.0) supports OAuth 2.0 PKCE for public clients without a client secret.

### Setup in Expo / React Native:
```typescript
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { MicrosoftAuthClient, OneDriveAuthClient } from 'local-lite/auth';

export const oneDriveAuth = new OneDriveAuthClient({
  clientId: 'YOUR_AZURE_APPLICATION_CLIENT_ID',
  redirectUri: Linking.createURL('oauth'),
  // 'Files.ReadWrite.AppFolder' grants access to dedicated OneDrive app storage
  scopes: ['openid', 'profile', 'email', 'User.Read', 'Files.ReadWrite.AppFolder'],
  authorize: async ({ authorizationUrl, redirectUri }) => {
    const result = await WebBrowser.openAuthSessionAsync(authorizationUrl, redirectUri);
    if (result.type !== 'success' || !result.url) return null;
    const url = new URL(result.url);
    return {
      code: url.searchParams.get('code') ?? '',
      state: url.searchParams.get('state') ?? '',
    };
  },
});
```

### Profile Returned (`MicrosoftUser` / `OneDriveUser`):
```typescript
export interface MicrosoftUser {
  id: string;
  email: string;
  name: string;
  givenName?: string;
  familyName?: string;
  picture?: string;
  userPrincipalName?: string;
}
```

---

## 3. GitHub Authentication

Authenticates users via GitHub OAuth and automatically fetches the user's profile and primary verified email address (handling private email profiles seamlessly).

### Setup in Expo / React Native:
```typescript
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { GitHubAuthClient } from 'local-lite/auth';

export const gitHubAuth = new GitHubAuthClient({
  clientId: 'YOUR_GITHUB_CLIENT_ID',
  clientSecret: process.env.GITHUB_CLIENT_SECRET, // Optional if using tokenExchangeUrl proxy
  redirectUri: Linking.createURL('oauth'),
  scopes: ['read:user', 'user:email'],
  authorize: async ({ authorizationUrl, redirectUri }) => {
    const result = await WebBrowser.openAuthSessionAsync(authorizationUrl, redirectUri);
    if (result.type !== 'success' || !result.url) return null;
    const url = new URL(result.url);
    return {
      code: url.searchParams.get('code') ?? '',
      state: url.searchParams.get('state') ?? '',
    };
  },
});
```

### Profile Returned (`GitHubUser`):
```typescript
export interface GitHubUser {
  id: string;
  login: string;
  name: string;
  email: string;
  avatarUrl?: string;
  bio?: string;
  company?: string;
  location?: string;
}
```

---

## ⚛️ React Hooks Usage

```tsx
import React from 'react';
import { View, Text, Button, Image } from 'react-native';
import { useGoogleAuth, useMicrosoftAuth, useGitHubAuth } from 'local-lite/react';
import { googleAuth, oneDriveAuth, gitHubAuth } from './auth';

export function LoginButtons() {
  const google = useGoogleAuth(googleAuth);
  const ms = useMicrosoftAuth(oneDriveAuth);
  const github = useGitHubAuth(gitHubAuth);

  return (
    <View style={{ gap: 10 }}>
      <Button title="Continue with Google" onPress={google.signIn} />
      <Button title="Continue with Microsoft / OneDrive" onPress={ms.signIn} />
      <Button title="Continue with GitHub" onPress={github.signIn} />
    </View>
  );
}
```

---

## 4. Sign in with Apple

`AppleAuthClient` supports both native iOS credentials (`expo-apple-authentication` / `ASAuthorizationAppleIDCredential`) and OAuth authorization flows. Because Apple provides full name and email **only on the very first sign-in**, `AppleAuthClient` automatically caches and preserves user details across sessions.

### Setup with `expo-apple-authentication`:
```typescript
import * as AppleAuthentication from 'expo-apple-authentication';
import { AppleAuthClient } from 'local-lite/auth';

export const appleAuth = new AppleAuthClient({
  clientId: 'com.yourcompany.app',
  nativeSignIn: async () => {
    const cred = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    return {
      user: cred.user,
      identityToken: cred.identityToken,
      authorizationCode: cred.authorizationCode,
      email: cred.email,
      fullName: cred.fullName,
    };
  },
});
```

### React Hook Example:
```tsx
import { useAppleAuth } from 'local-lite/react';
import { appleAuth } from './auth';

export function AppleLoginButton() {
  const { user, isSignedIn, signIn, signOut } = useAppleAuth(appleAuth);

  if (isSignedIn && user) {
    return (
      <View>
        <Text>Welcome {user.name ?? user.email}!</Text>
        <Button title="Sign Out" onPress={signOut} />
      </View>
    );
  }

  return <Button title="Sign in with Apple" onPress={() => signIn()} />;
}
```

---

## 💾 Session Persistence Adapters

All auth clients accept a `storage` option compatible with any key-value store (AsyncStorage, SQLite kv-store, MMKV, or SecureStore):

```typescript
import AsyncStorage from 'expo-sqlite/kv-store';
import {
  createGoogleAuthTokenStore,
  createMicrosoftAuthTokenStore,
  createGitHubAuthTokenStore,
  createAppleAuthTokenStore,
} from 'local-lite/auth';

const storage = {
  getItem: async (key: string) => {
    const val = await AsyncStorage.getItem(key);
    return val ? JSON.parse(val) : null;
  },
  setItem: async (key: string, value: unknown) => {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  },
  removeItem: async (key: string) => {
    await AsyncStorage.removeItem(key);
  },
};

const googleTokenStore = createGoogleAuthTokenStore(storage);
const msTokenStore = createMicrosoftAuthTokenStore(storage);
const ghTokenStore = createGitHubAuthTokenStore(storage);
const appleTokenStore = createAppleAuthTokenStore(storage);
```

---

## 🔒 5. Fully Local Authentication Engine (`auth/local`)

For standalone offline-first apps, local-only modes, or self-contained credentials without third-party OAuth, `local-lite` provides a zero-backend **LocalAuthEngine** storing credentials directly in SQLite.

```typescript
import { LocalAuthEngine } from 'local-lite/auth/local';
// or access client.auth directly on LocalFirstClient:
import { useLocalAuth } from 'local-lite/react';
```

### Features & Security:
* **🛡️ High-Level Crypto Credentials:** PBKDF2 with SHA-256 key derivation, 1,000 rounds by default (fast execution on mobile Hermes and WebCrypto), with automated transparent migration of legacy SHA-512 hashes.
* **⏱️ Constant-Time Verification:** Password comparison uses timing-safe XOR operations to defeat side-channel timing attacks.
* **🚫 Brute-Force & Lockout Protection:** Automatically tracks consecutive failed login attempts and locks accounts temporarily (default: 5 failed attempts locks for 15 minutes).
* **🔑 Single-Use Password Reset Tokens:** Cryptographically secure 32-byte tokens stored only as SHA-256 hashes with configurable expiry.
* **👤 SQLite `_local_users` Table:** Stores sanitized user profiles, usernames, case-insensitive emails, roles, JSON metadata, and status (`active`, `suspended`, `locked`).
* **🔄 Pluggable Remote Auth Exchange:** `remoteAuthHandler` automatically exchanges local credentials with your backend to retrieve and cache remote sync JWTs.
* **📱 Integrated Offline Sessions:** Automatically creates and persists sessions in `SessionManager` so users stay logged in offline.

### Basic Usage:

```typescript
// Standalone or via client.auth:
const { user, session } = await client.auth.signUp({
  email: 'alice@example.com',
  username: 'alice',
  password: 'SuperSecretPassword123!',
  displayName: 'Alice Wonderland',
  metadata: { role: 'admin' },
});

// Sign In with email or username:
const { user, session } = await client.auth.signIn({
  identifier: 'alice@example.com', // or username 'alice'
  password: 'SuperSecretPassword123!',
});

// Password Change:
await client.auth.changePassword({
  userId: user.id,
  oldPassword: 'SuperSecretPassword123!',
  newPassword: 'BrandNewPassword456!',
});

// Password Reset Flow:
const { token } = await client.auth.createPasswordResetToken('alice@example.com');
await client.auth.resetPasswordWithToken(token, 'BrandNewPassword456!');

// Account Administration:
await client.auth.updateUser(user.id, { status: 'suspended' }); // blocks login
await client.auth.unlockAccount(user.id);

// Sign Out:
await client.auth.signOut();
```

### React Hook (`useLocalAuth`):

```tsx
import { useLocalAuth } from 'local-lite/react';

export function AuthScreen({ client }) {
  const { user, isSignedIn, loading, signIn, signUp, signOut } = useLocalAuth(client.auth);

  if (loading) return <Text>Loading user state...</Text>;

  if (isSignedIn) {
    return (
      <View>
        <Text>Welcome back, {user.displayName || user.email}!</Text>
        <Button title="Sign Out" onPress={() => signOut()} />
      </View>
    );
  }

  return (
    <LoginForm
      onLogin={(email, password) => signIn(email, password)}
      onRegister={(email, password) => signUp({ email, password })}
    />
  );
}
```

---

## 🔗 6. Multi-Provider Identity Unification (`UnifiedAuthManager`)

When combining local authentication with third-party OAuth providers, `UnifiedAuthManager` automatically generates a deterministic UUIDv5 canonical identity linked to the user's verified email address:

```typescript
import {
  UnifiedAuthManager,
  GoogleAuthClient,
  GitHubAuthClient,
  SessionManager,
} from 'local-lite/auth';

const sessionManager = new SessionManager(client.getAdapter());
await sessionManager.initialize();

export const unifiedAuth = new UnifiedAuthManager({
  google: googleClient,
  github: githubClient,
  local: client.auth,
  sessionManager,
  unifyByEmail: true,
});

// User logs in via Google:
const user = await unifiedAuth.signIn('google');
console.log('Canonical User ID:', user.userId);

// Later, the same user logs in via GitHub with the same verified email:
// They are mapped to the EXACT same canonical user.userId in SQLite!
```


