# Offline-First Session Management (`client.session` & `useSession`)

In traditional web applications, authentication depends on continuous pings to a remote authorization server. When the device loses internet connectivity, token refresh calls fail, causing apps to mistakenly clear the session and boot users back to the login screen.

`local-lite` provides **persistent, offline-first session management** in SQLite (`_local_sessions`), ensuring authenticated users stay logged in and productive even when completely offline.

---

## Features

- **Persistent SQLite Storage**: Session metadata, user profiles, permissions, and tokens are stored in `_local_sessions`.
- **Offline Grace Period**: Configurable offline access duration (default: 30 days, or unlimited). If server tokens expire while offline, the local session remains valid and active until connectivity is restored.
- **Multi-Account Switching**: Store and switch between multiple user profiles or organizations without signing out.
- **Provider Agnostic**: Works with **Google**, **Microsoft**, **GitHub**, **Apple**, **Supabase Auth**, **Firebase Auth**, or custom JWT/password backends.
- **Reactive React Hook (`useSession`)**: Component state updates automatically on session creation, profile updates, account switches, or sign out.

---

## Basic Usage

### 1. Creating a Session (on Sign-In)

When your user signs in (via OAuth, email/password, biometric PIN, or Supabase Auth):

```typescript
// Create and persist active session
await client.session.createSession({
  userId: 'usr_123',
  user: {
    id: 'usr_123',
    name: 'Sarah Connor',
    email: 'sarah@example.com',
    role: 'ADMIN',
    organizationId: 'org_omega',
  },
  token: 'jwt_access_token...',
  refreshToken: 'refresh_token...',
  provider: 'supabase', // or 'google', 'custom', etc.
  offlineDurationMs: 30 * 24 * 60 * 60 * 1000, // 30-day offline access
});
```

---

### 2. Checking Authentication State

```typescript
// True both online AND offline:
const isAuthenticated = await client.session.isAuthenticated();

// Retrieve cached user profile offline:
const user = await client.session.getUser();
console.log(user?.name); // 'Sarah Connor'

// Retrieve active session record:
const session = await client.session.getActiveSession();
console.log(session?.lastActiveAt);
```

---

### 3. Updating User Profile & Tokens

```typescript
// Update user metadata in SQLite:
await client.session.updateUser({
  role: 'SUPER_ADMIN',
  avatarUrl: 'https://cdn.example.com/sarah.jpg',
});

// Update tokens after remote refresh:
await client.session.updateTokens({
  token: 'new_access_token...',
  expiresAt: Date.now() + 3600000,
});
```

---

### 4. Multi-Account Switching Offline

Switch between cached accounts without requiring a network round-trip:

```typescript
// List all accounts stored on device:
const sessions = await client.session.listSessions();

// Switch active user:
await client.session.switchSession('usr_456');
```

---

### 5. Signing Out

```typescript
await client.session.clearSession();
```

---

## React & Expo Integration (`useSession`)

Use the `useSession` hook in your React or Expo components:

```tsx
import React from 'react';
import { useSession } from 'local-lite/react';

export function UserHeader({ client }) {
  const { user, isAuthenticated, isOffline, signOut } = useSession(client);

  if (!isAuthenticated) {
    return <p>Please sign in</p>;
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span>Welcome, {user.name}!</span>
      {isOffline && (
        <span style={{ color: 'orange', fontSize: '12px' }}>
          (Offline Mode - Active Session)
        </span>
      )}
      <button onClick={signOut}>Sign Out</button>
    </div>
  );
}
```
