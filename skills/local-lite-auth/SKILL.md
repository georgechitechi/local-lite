---
name: local-lite-auth
description: Implement authentication and session management in local-lite. Use when setting up zero-backend local SQLite authentication (LocalAuthEngine, useLocalAuth), configuring PBKDF2 crypto, brute-force lockout, single-use reset tokens, remoteAuthHandler JWT exchange, UnifiedAuthManager multi-provider linking, or integrating OAuth providers (Google, Microsoft, GitHub, Apple) and offline sessions.
---

# local-lite Authentication

Comprehensive guide for implementing zero-backend local SQLite authentication, multi-provider identity unification, and OAuth integrations in `local-lite`.

---

## 1. Zero-Backend Local SQLite Auth (`LocalAuthEngine`)

`LocalAuthEngine` provides fully local, client-side authentication stored directly in private SQLite tables (`_local_users` and `_local_user_tokens`). It requires no remote servers or cloud accounts.

### Features
* **PBKDF2-SHA256 Cryptography**: Fast, unboxed 32-bit integer arithmetic optimized for mobile (Hermes) and hardware-accelerated WebCrypto on Web. Seamless auto-migration of legacy `PBKDF2-SHA512` hashes upon successful sign-in.
* **Cryptographic Salting**: 16-byte (128-bit) secure random salt per user to prevent rainbow table attacks.
* **Timing-Attack Protection**: Constant-time byte comparisons (`timingSafeEqual`) and dummy verification for non-existent accounts.
* **Brute-Force Lockout**: Automatically locks accounts after consecutive failed attempts for a configurable duration.
* **Single-Use Reset Tokens**: 32-byte high-entropy tokens with SHA-256 storage and automated expiration.
* **Pluggable Remote Auth Exchange**: `remoteAuthHandler` automatically exchanges local credentials with your backend to retrieve and cache remote JWTs.
* **User Status Lifecycle**: Active, locked, or suspended accounts (`status: 'active' | 'locked' | 'suspended'`). Suspended accounts are immediately rejected on sign-in.
* **Offline Sessions**: Integrated with `SessionManager` for persistent multi-device or single-device offline session lifecycles.

---

## 2. Configuration

Configure local auth directly in `defineSyncConfig`:

```typescript
import { defineSyncConfig } from 'local-lite/config';

export const syncConfig = defineSyncConfig({
  database: () => SQLite.openDatabaseAsync('app.db'),
  tables: ['tasks'],
  localAuth: {
    // Optional table names (defaults: '_local_users', '_local_user_tokens')
    usersTable: '_local_users',
    tokensTable: '_local_user_tokens',

    // Password requirements & custom validation (returns boolean or custom error string)
    minPasswordLength: 8,
    validatePassword: (password: string) => {
      if (!/[0-9]/.test(password)) return 'Password must include at least one number.';
      if (!/[A-Z]/.test(password)) return 'Password must include at least one uppercase letter.';
      return true;
    },

    // Brute-force lockout protection
    maxFailedAttempts: 5,               // Set to 0 to disable
    lockoutDurationMs: 15 * 60 * 1000,  // 15 minutes

    // Password reset token expiration
    resetTokenExpiryMs: 60 * 60 * 1000, // 1 hour

    // Tuning (defaults: 'PBKDF2-SHA256' with 1,000 rounds)
    algorithm: 'PBKDF2-SHA256',
    iterations: 1_000,

    // Optional remote auth token exchange (e.g. swap local login for backend JWT)
    remoteAuthHandler: async ({ user, session }) => {
      const res = await fetch('https://api.example.com/auth/sync-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, email: user.email }),
      });
      const data = await res.json();
      return { token: data.token };
    },
  },
});
```

---

## 3. Using `useLocalAuth` in React / React Native

The `useLocalAuth` hook exposes reactive user state, active session info, and authentication actions:

```tsx
import React, { useState } from 'react';
import { View, Text, TextInput, Button, Alert } from 'react-native';
import { useLocalAuth } from 'local-lite/react';
import { getSyncClient } from './sync.config';

export function AuthScreen() {
  const [client, setClient] = useState(null);
  React.useEffect(() => { getSyncClient().then(setClient); }, []);

  const {
    user,
    session,
    isSignedIn,
    loading,
    error,
    signIn,
    signUp,
    signOut,
    refetchUser,
  } = useLocalAuth(client?.auth);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  if (isSignedIn && user) {
    return (
      <View>
        <Text>Welcome, {user.displayName || user.email}!</Text>
        <Text>Role: {user.role}</Text>
        <Text>Session ID: {session?.id}</Text>
        <Button title="Sign Out" onPress={() => signOut()} />
      </View>
    );
  }

  return (
    <View>
      <TextInput placeholder="Email" value={email} onChangeText={setEmail} autoCapitalize="none" />
      <TextInput placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry />
      
      <Button
        title={loading ? 'Processing...' : 'Sign In'}
        onPress={() => signIn(email, password).catch(err => Alert.alert('Error', err.message))}
        disabled={loading}
      />
      <Button
        title="Register New Account"
        onPress={() =>
          signUp({
            email,
            password,
            displayName: 'Alice',
            role: 'admin',
            metadata: { theme: 'dark' },
          }).catch(err => Alert.alert('Error', err.message))
        }
      />
    </View>
  );
}
```

---

## 4. Password Management & Administrative Controls

### Changing Passwords (User Authenticated)
```typescript
await client.auth.changePassword({
  userId: user.id,
  oldPassword: 'OldPassword123!',
  newPassword: 'NewPassword456!',
});
```

### Password Reset Flow (Forgot Password)
```typescript
// 1. Generate a single-use 32-byte reset token (expires in 1 hour)
const { token, expiresAt } = await client.auth.createPasswordResetToken('user@example.com');

// 2. Deliver token to user via local notification, SMS, or QR code

// 3. User submits the token with their new password
await client.auth.resetPasswordWithToken(token, 'NewStrongPassword789!');
// The token is permanently invalidated in SQLite and the account is unlocked.
```

### Administrative User Controls
```typescript
// Suspend an abusive or compromised account
await client.auth.updateUser(userId, { status: 'suspended' });

// Manually unlock an account
await client.auth.unlockAccount(userId);

// Delete user and cascade clear tokens
await client.auth.deleteUser(userId);
```

---

## 5. Multi-Provider Identity Unification (`UnifiedAuthManager`)

When supporting both local authentication and third-party OAuth providers, `UnifiedAuthManager` generates a canonical, deterministic `userId` linking accounts by verified email:

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
  unifyByEmail: true, // Derives canonical UUIDv5 by normalized verified email
});

// Sign in with any provider - user sessions and local tables link seamlessly
const user = await unifiedAuth.signIn('google');
console.log('Unified Canonical User ID:', user.userId);

// Listen to unified state changes
const unsubscribe = unifiedAuth.onAuthStateChange((user) => {
  console.log('Active User:', user?.email);
});

// Cleanup when unmounting
unifiedAuth.destroy();
```

---

## 6. Standalone OAuth Providers

`local-lite/auth` includes standalone PKCE OAuth clients with matching React hooks:

* **Google**: `GoogleAuthClient` / `useGoogleAuth`
* **Microsoft & OneDrive**: `MicrosoftAuthClient` / `OneDriveAuthClient` / `useMicrosoftAuth`
* **GitHub**: `GitHubAuthClient` / `useGitHubAuth`
* **Apple**: `AppleAuthClient` / `useAppleAuth`
