---
name: local-lite-auth
description: Implement authentication and session management in local-lite. Use when setting up zero-backend local SQLite authentication (LocalAuthEngine, useLocalAuth), configuring PBKDF2 crypto, brute-force lockout, single-use reset tokens, or integrating OAuth providers (Google, Microsoft, GitHub, Apple) and offline sessions.
---

# local-lite Authentication

Comprehensive guide for implementing zero-backend local SQLite authentication and OAuth integrations in `local-lite`.

---

## 1. Zero-Backend Local SQLite Auth (`LocalAuthEngine`)

`LocalAuthEngine` provides fully local, client-side authentication stored directly in private SQLite tables (`_local_users` and `_local_user_tokens`). It requires no remote servers or cloud accounts.

### Features
* **PBKDF2-SHA256 Cryptography**: Fast, unboxed 32-bit integer arithmetic optimized for mobile (Hermes) and hardware-accelerated WebCrypto on Web.
* **Cryptographic Salting**: 16-byte (128-bit) secure random salt per user to prevent rainbow table attacks.
* **Timing-Attack Protection**: Constant-time byte comparisons (`timingSafeEqual`) and dummy verification for non-existent accounts.
* **Brute-Force Lockout**: Automatically locks accounts after consecutive failed attempts for a configurable duration.
* **Single-Use Reset Tokens**: 32-byte high-entropy tokens with SHA-256 storage and automated expiration.
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

    // Password requirements & validation
    minPasswordLength: 8,
    validatePassword: (password: string) => {
      if (!/[0-9]/.test(password)) return 'Password must include at least one number.';
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

## 4. Password Management & Cryptographic Resets

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

---

## 5. OAuth Providers & Cloud Auth

`local-lite/auth` also includes standalone OAuth clients and hooks for external identity providers:

### Google OAuth
```typescript
import { GoogleAuthClient } from 'local-lite/auth';
import { useGoogleAuth } from 'local-lite/react';

const googleClient = new GoogleAuthClient({
  clientId: 'YOUR_GOOGLE_CLIENT_ID',
  redirectUri: 'YOUR_REDIRECT_URI',
  scopes: ['openid', 'profile', 'email'],
  authorize: async (req) => { /* invoke browser or WebBrowser.openAuthSessionAsync */ },
});
```

### Microsoft OAuth & OneDrive
```typescript
import { MicrosoftAuthClient } from 'local-lite/auth';

const msClient = new MicrosoftAuthClient({
  clientId: 'YOUR_MS_CLIENT_ID',
  redirectUri: 'YOUR_REDIRECT_URI',
  scopes: ['openid', 'profile', 'User.Read', 'Files.ReadWrite.AppFolder'],
  authorize: async (req) => { /* invoke browser */ },
});
```

### Apple & GitHub OAuth
Clients are available via `AppleAuthClient` and `GitHubAuthClient` with matching React hooks (`useAppleAuth`, `useGitHubAuth`).

