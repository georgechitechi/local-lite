# 🔑 Authentication (Google, Microsoft / OneDrive & GitHub)

`local-lite` provides zero-backend, PKCE-secured authentication clients and React hooks out of the box for the three most popular identity providers:
* **Google** (`GoogleAuthClient`, `useGoogleAuth`)
* **Microsoft / OneDrive** (`MicrosoftAuthClient`, `OneDriveAuthClient`, `useMicrosoftAuth`, `useOneDriveAuth`)
* **GitHub** (`GitHubAuthClient`, `useGitHubAuth`)

Built specifically for local-first architectures, these clients allow your Expo, React Native, Web, or Desktop application to authenticate users directly without requiring an intermediate backend auth server.

```typescript
import {
  GoogleAuthClient,
  MicrosoftAuthClient,
  OneDriveAuthClient,
  GitHubAuthClient,
} from 'local-lite/auth';

import {
  useGoogleAuth,
  useMicrosoftAuth,
  useOneDriveAuth,
  useGitHubAuth,
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

## 💾 Session Persistence Adapters

All three clients accept a `storage` option compatible with any key-value store (AsyncStorage, SQLite kv-store, MMKV, or SecureStore):

```typescript
import AsyncStorage from 'expo-sqlite/kv-store';
import {
  createGoogleAuthTokenStore,
  createMicrosoftAuthTokenStore,
  createGitHubAuthTokenStore,
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
```
