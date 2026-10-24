# 🔑 Google Sign-In & Authentication

`local-lite` provides a zero-backend, zero-lock-in **Google OAuth 2.0 PKCE client** and React hook out of the box.

Built specifically for local-first architectures, it allows your Expo, React Native, or Web application to sign in users directly with Google without requiring a dedicated auth server, Supabase, or Firebase.

```typescript
import { GoogleAuthClient } from 'local-lite/auth';
import { useGoogleAuth } from 'local-lite/react';
```

---

## 🌟 Features

* **🛡️ PKCE Security (RFC 7636):** Automatic cryptographically secure 32-byte `code_verifier`, SHA-256 (`S256`) code challenge generation, and CSRF state validation.
* **👤 User Profile Fetching:** Retrieves verified user profile (`id`, `email`, `name`, `picture`, `locale`) from Google's UserInfo endpoint upon sign-in.
* **🔄 Transparent Token Refreshing:** Automatically checks token expiration and uses Google's `refresh_token` endpoint if the access token is within 60 seconds of expiry.
* **💾 Pluggable Storage:** Use `createInMemoryGoogleTokenStore()` (default) or `createGoogleAuthTokenStore(storage)` for persistent storage (AsyncStorage, MMKV, SecureStore, etc.).
* **⚛️ First-Class React Hook:** `useGoogleAuth()` provides reactive user state, sign-in, sign-out, and auto-subscriptions.
* **☁️ Google Drive Backup Synergy:** Pair with `local-lite/backups` to back up and restore SQLite database snapshots directly to the user's Google Drive using the same authenticated session.

---

## 🚀 Quickstart in Expo / React Native

### 1. Install Dependencies

```bash
npx expo install expo-web-browser expo-linking
```

### 2. Configure Google Cloud Console

1. Go to the [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
2. Create an **OAuth 2.0 Client ID** (select **Web application** or native app depending on your redirect flow).
3. Add your app's redirect URI (e.g. `myapp://oauth` or `https://auth.expo.io/@yourname/myapp`).

### 3. Initialize `GoogleAuthClient`

Create a shared authentication instance:

```typescript
// auth.ts
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { GoogleAuthClient, createGoogleAuthTokenStore } from 'local-lite/auth';

// Tell WebBrowser to complete any pending auth sessions on web/native
WebBrowser.maybeCompleteAuthSession();

export const googleAuth = new GoogleAuthClient({
  clientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID || 'YOUR_CLIENT_ID.apps.googleusercontent.com',
  redirectUri: Linking.createURL('oauth'),
  scopes: ['openid', 'email', 'profile'],
  authorize: async ({ authorizationUrl, redirectUri }) => {
    const result = await WebBrowser.openAuthSessionAsync(authorizationUrl, redirectUri);
    if (result.type !== 'success' || !result.url) {
      return null; // User cancelled
    }
    const callback = new URL(result.url);
    return {
      code: callback.searchParams.get('code') ?? '',
      state: callback.searchParams.get('state') ?? '',
    };
  },
});
```

---

## ⚛️ React Integration with `useGoogleAuth`

Use the `useGoogleAuth` hook to bind user login state directly to your UI:

```tsx
import React from 'react';
import { View, Text, Button, Image, StyleSheet } from 'react-native';
import { useGoogleAuth } from 'local-lite/react';
import { googleAuth } from './auth';

export function UserHeader() {
  const { user, isSignedIn, loading, signIn, signOut } = useGoogleAuth(googleAuth);

  if (loading) {
    return <Text style={styles.status}>Checking authentication...</Text>;
  }

  if (!isSignedIn || !user) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Guest Mode</Text>
        <Text style={styles.subtitle}>Sign in with Google to enable cloud backups.</Text>
        <Button title="Sign In with Google" onPress={signIn} />
      </View>
    );
  }

  return (
    <View style={styles.card}>
      {user.picture && (
        <Image source={{ uri: user.picture }} style={styles.avatar} />
      )}
      <View style={styles.info}>
        <Text style={styles.name}>{user.name}</Text>
        <Text style={styles.email}>{user.email}</Text>
      </View>
      <Button title="Sign Out" onPress={signOut} color="#ef4444" />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, borderRadius: 12, backgroundColor: '#f8fafc', marginBottom: 12 },
  status: { padding: 16, color: '#64748b' },
  avatar: { width: 44, height: 44, borderRadius: 22, marginBottom: 8 },
  title: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  subtitle: { fontSize: 13, color: '#64748b', marginBottom: 10 },
  info: { marginBottom: 10 },
  name: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  email: { fontSize: 13, color: '#64748b' },
});
```

---

## 💾 Persistent Token & Profile Storage

By default, `GoogleAuthClient` stores credentials in memory. To keep users signed in across app restarts, pass a key-value storage adapter (such as `AsyncStorage` or `expo-secure-store`):

```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleAuthClient, createGoogleAuthTokenStore } from 'local-lite/auth';

const persistentStore = createGoogleAuthTokenStore({
  getItem: async (key) => {
    const value = await AsyncStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  },
  setItem: async (key, value) => {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  },
  removeItem: async (key) => {
    await AsyncStorage.removeItem(key);
  },
}, 'my-app-auth');

export const googleAuth = new GoogleAuthClient({
  clientId: 'YOUR_CLIENT_ID.apps.googleusercontent.com',
  redirectUri: 'myapp://oauth',
  tokenStore: persistentStore,
  authorize: openBrowserSession,
});
```

---

## ☁️ Google Drive Backup Synergy

If you request the `'https://www.googleapis.com/auth/drive.file'` scope during login, the same `GoogleAuthClient` can power SQLite database backups to Google Drive without requiring the user to authenticate a second time:

```typescript
import { GoogleAuthClient } from 'local-lite/auth';
import { createDatabaseBackup, restoreDatabaseBackup } from 'local-lite/backups';

export const googleAuth = new GoogleAuthClient({
  clientId: 'YOUR_CLIENT_ID.apps.googleusercontent.com',
  redirectUri: 'myapp://oauth',
  scopes: [
    'openid',
    'email',
    'profile',
    'https://www.googleapis.com/auth/drive.file', // Request Drive access
  ],
  authorize: openBrowserSession,
});

// Create Google Drive storage powered by the authenticated user's session
const driveStorage = googleAuth.createDriveBackupStorage();

// Export SQLite database to Google Drive
export async function backupToDrive(databaseAdapter) {
  const fileName = await createDatabaseBackup(databaseAdapter, driveStorage);
  console.log(`Database saved to Google Drive: ${fileName}`);
}

// List and restore backups
export async function restoreFromDrive(databaseAdapter, fileName) {
  const backups = await driveStorage.list();
  console.log('Available backups on Drive:', backups);
  await restoreDatabaseBackup(databaseAdapter, driveStorage, fileName);
}
```

---

## 📖 API Reference

### `GoogleAuthClientOptions`

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `clientId` | `string` | *(Required)* | Google OAuth 2.0 Web or Native client ID. |
| `redirectUri` | `string` | *(Required)* | Redirect callback URI registered in Google Console. |
| `scopes` | `string[]` | `['openid', 'email', 'profile']` | OAuth scopes to request from Google. |
| `authorize` | `(req) => Promise<res \| null>` | *(Required)* | Function that opens the system browser session and returns code + state. |
| `tokenStore` | `GoogleAuthTokenStore` | In-memory store | Token & profile storage adapter. |
| `prompt` | `'select_account' \| 'consent' \| 'none'` | `'select_account'` | Google consent prompt behavior. |
| `accessType` | `'offline' \| 'online'` | `'offline'` | Requests a refresh token when set to `'offline'`. |

### `GoogleUser`

```typescript
export interface GoogleUser {
  id: string;          // Google sub identifier
  email: string;       // User's verified email address
  emailVerified: boolean;
  name: string;        // Full name
  givenName?: string;  // First name
  familyName?: string; // Last name
  picture?: string;    // Avatar URL
  locale?: string;     // Preferred language/locale
}
```

### `GoogleAuthClient` Methods

* **`signIn(): Promise<GoogleUser | null>`**: Starts PKCE authorization flow, exchanges code for tokens, fetches user profile, and notifies listeners. Returns `null` if user cancels.
* **`signOut(): Promise<void>`**: Clears stored tokens and cached profile, notifying all subscribers.
* **`isSignedIn(): Promise<boolean>`**: Checks whether a valid or refreshable session exists.
* **`getUser(): Promise<GoogleUser | null>`**: Returns the current signed-in user profile, reading from cache or fetching via valid access token.
* **`getValidAccessToken(): Promise<string>`**: Returns a fresh access token, automatically refreshing if expired or expiring within 60 seconds.
* **`onAuthStateChange(listener): () => void`**: Subscribes to auth status changes (`GoogleUser | null`). Returns an unsubscribe function.
* **`createDriveBackupStorage(): GoogleDriveBackupStorage`**: Returns a `GoogleDriveBackupStorage` instance ready for use with `createDatabaseBackup()` / `restoreDatabaseBackup()`.
