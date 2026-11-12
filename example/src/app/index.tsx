import { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { getClient } from '../lib/sync';
import type { LocalFirstClient } from 'local-lite/config';
import type { LocalUser } from 'local-lite/auth';
import { useLocalAuth } from 'local-lite/react';

type Tab = 'auth' | 'profile' | 'reset' | 'lockout' | 'users';

export default function Index() {
  const [client, setClient] = useState<LocalFirstClient | null>(null);
  const [initLoading, setInitLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('auth');
  const [message, setMessage] = useState<{
    text: string;
    type: 'success' | 'error';
  } | null>(null);

  // Form states
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('demo@example.com');
  const [username, setUsername] = useState('demouser');
  const [displayName, setDisplayName] = useState('Demo User');
  const [password, setPassword] = useState('Password123!');
  const [role, setRole] = useState('user');

  // Change password states
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  // Password reset states
  const [resetIdentifier, setResetIdentifier] = useState('demo@example.com');
  const [generatedToken, setGeneratedToken] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('NewPass123!');

  // Users table inspector
  const [allUsers, setAllUsers] = useState<LocalUser[]>([]);
  const [refreshingUsers, setRefreshingUsers] = useState(false);

  // Initialize local-lite client
  useEffect(() => {
    let mounted = true;
    getClient()
      .then((c) => {
        if (mounted) {
          setClient(c);
          setInitLoading(false);
        }
      })
      .catch((err) => {
        if (mounted) {
          setInitLoading(false);
          setMessage({
            text: 'Client initialization failed: ' + err.message,
            type: 'error',
          });
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  // Use the reactive useLocalAuth hook
  const {
    user,
    session,
    isSignedIn,
    loading: authLoading,
    signIn,
    signUp,
    signOut,
  } = useLocalAuth(client?.auth);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setMessage({ text, type });
    if (Platform.OS !== 'web') {
      Alert.alert(type === 'success' ? 'Success' : 'Error', text);
    }
  };

  const loadAllUsers = useCallback(async () => {
    if (!client) return;
    setRefreshingUsers(true);
    try {
      const users = await client.auth.listUsers();
      setAllUsers(users);
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setRefreshingUsers(false);
    }
  }, [client]);

  useEffect(() => {
    if (activeTab === 'users' && client) {
      loadAllUsers();
    }
  }, [activeTab, client, loadAllUsers]);

  // Sign In / Sign Up handler
  const handleAuthSubmit = async () => {
    setMessage(null);
    try {
      if (isRegister) {
        await signUp({
          email,
          username: username.trim() || undefined,
          displayName: displayName.trim() || undefined,
          password,
          role,
          metadata: { appVersion: '1.0.0', platform: Platform.OS },
        });
        showToast('Account registered and session created in local SQLite!');
      } else {
        await signIn(email.trim() || username.trim(), password);
        showToast('Signed in successfully!');
      }
    } catch (err: any) {
      const msg = err.message || String(err);
      if (!isRegister && msg.includes('Invalid')) {
        showToast(
          'Account not found or password incorrect. If you haven\'t registered yet, tap "Don\'t have an account? Register" below!',
          'error',
        );
      } else {
        showToast(msg, 'error');
      }
    }
  };

  // Change Password
  const handleChangePassword = async () => {
    if (!client || !user) return;
    setMessage(null);
    try {
      await client.auth.changePassword({
        userId: user.id,
        oldPassword,
        newPassword,
      });
      setOldPassword('');
      setNewPassword('');
      showToast('Password changed successfully with new cryptographic salt!');
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  // Generate Reset Token
  const handleGenerateResetToken = async () => {
    if (!client) return;
    setMessage(null);
    try {
      const res = await client.auth.createPasswordResetToken(resetIdentifier);
      setGeneratedToken(res.token);
      setTokenInput(res.token);
      showToast('Generated 32-byte single-use token (expires in 1 hour)');
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  // Redeem Reset Token
  const handleRedeemResetToken = async () => {
    if (!client) return;
    setMessage(null);
    try {
      await client.auth.resetPasswordWithToken(tokenInput, resetNewPassword);
      setGeneratedToken('');
      setTokenInput('');
      showToast('Password reset successfully with token! You can now sign in.');
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  // Test account lockout: simulate 3 bad passwords
  const handleSimulateLockout = async () => {
    if (!client) return;
    setMessage(null);
    const target = email || 'demo@example.com';
    let lastError = '';
    for (let i = 1; i <= 3; i++) {
      try {
        await client.auth.signIn({
          identifier: target,
          password: 'WrongPassword_' + i,
        });
      } catch (err: any) {
        lastError = err.message;
      }
    }
    showToast(`Lockout simulated: ${lastError}`, 'error');
  };

  // Unlock account
  const handleUnlockAccount = async () => {
    if (!client) return;
    try {
      const u = await client.auth.getUserByEmail(email);
      if (u) {
        await client.auth.unlockAccount(u.id);
        showToast(`Account (${u.email}) unlocked! Failed attempts reset to 0.`);
      } else {
        showToast('User not found by email.', 'error');
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  if (initLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0284c7" />
        <Text style={styles.loadingText}>
          Initializing local SQLite auth engine...
        </Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>⚡ local-lite Local Auth</Text>
        <Text style={styles.subtitle}>
          Fully local SQLite user database, fast PBKDF2-SHA256 crypto & offline
          sessions
        </Text>
        <View style={styles.badgeRow}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>DB: SQLite (Expo)</Text>
          </View>
          <View
            style={[
              styles.badge,
              isSignedIn ? styles.badgeSuccess : styles.badgeMuted,
            ]}
          >
            <Text style={styles.badgeText}>
              {isSignedIn
                ? `Logged in: ${user?.displayName || user?.email}`
                : 'Logged Out'}
            </Text>
          </View>
        </View>
      </View>

      {/* Toast Alert */}
      {message && (
        <View
          style={[
            styles.alert,
            message.type === 'error' ? styles.alertError : styles.alertSuccess,
          ]}
        >
          <Text style={styles.alertText}>{message.text}</Text>
        </View>
      )}

      {/* Tab Navigation */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[
            styles.tabButton,
            activeTab === 'auth' && styles.tabButtonActive,
          ]}
          onPress={() => setActiveTab('auth')}
        >
          <Text
            style={[
              styles.tabButtonText,
              activeTab === 'auth' && styles.tabButtonTextActive,
            ]}
          >
            {isSignedIn ? 'Profile' : isRegister ? 'Register' : 'Sign In'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.tabButton,
            activeTab === 'reset' && styles.tabButtonActive,
          ]}
          onPress={() => setActiveTab('reset')}
        >
          <Text
            style={[
              styles.tabButtonText,
              activeTab === 'reset' && styles.tabButtonTextActive,
            ]}
          >
            Reset Token
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.tabButton,
            activeTab === 'lockout' && styles.tabButtonActive,
          ]}
          onPress={() => setActiveTab('lockout')}
        >
          <Text
            style={[
              styles.tabButtonText,
              activeTab === 'lockout' && styles.tabButtonTextActive,
            ]}
          >
            Lockout Test
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.tabButton,
            activeTab === 'users' && styles.tabButtonActive,
          ]}
          onPress={() => setActiveTab('users')}
        >
          <Text
            style={[
              styles.tabButtonText,
              activeTab === 'users' && styles.tabButtonTextActive,
            ]}
          >
            Users DB
          </Text>
        </TouchableOpacity>
      </View>

      {/* TAB 1: AUTH & PROFILE */}
      {activeTab === 'auth' && (
        <View style={styles.card}>
          {isSignedIn && user ? (
            <View>
              <Text style={styles.cardHeader}>
                👤 Authenticated User Profile
              </Text>

              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>ID:</Text>
                <Text style={styles.infoVal}>{user.id}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Email:</Text>
                <Text style={styles.infoVal}>{user.email}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Username:</Text>
                <Text style={styles.infoVal}>{user.username || '—'}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Display Name:</Text>
                <Text style={styles.infoVal}>{user.displayName || '—'}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Role:</Text>
                <Text style={styles.infoVal}>{user.role}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Status:</Text>
                <Text
                  style={[
                    styles.infoVal,
                    { color: '#16a34a', fontWeight: 'bold' },
                  ]}
                >
                  {user.status}
                </Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Active Session:</Text>
                <Text style={styles.infoVal}>{session?.id || '—'}</Text>
              </View>

              <View style={styles.divider} />

              <Text style={styles.sectionSubtitle}>Change Password</Text>
              <TextInput
                style={styles.input}
                placeholder="Current Password"
                secureTextEntry
                value={oldPassword}
                onChangeText={setOldPassword}
              />
              <TextInput
                style={styles.input}
                placeholder="New Password (min 6 chars)"
                secureTextEntry
                value={newPassword}
                onChangeText={setNewPassword}
              />
              <TouchableOpacity
                style={[styles.primaryButton, { marginBottom: 12 }]}
                onPress={handleChangePassword}
              >
                <Text style={styles.primaryButtonText}>Update Password</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.dangerButton}
                onPress={() => signOut()}
              >
                <Text style={styles.dangerButtonText}>Sign Out</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View>
              <Text style={styles.cardHeader}>
                {isRegister
                  ? 'Create Local User Account'
                  : 'Sign In with Local SQLite'}
              </Text>

              <Text style={styles.label}>Email Address</Text>
              <TextInput
                style={styles.input}
                placeholder="you@example.com"
                value={email}
                autoCapitalize="none"
                keyboardType="email-address"
                onChangeText={setEmail}
              />

              {isRegister && (
                <>
                  <Text style={styles.label}>Username (Optional)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="username"
                    value={username}
                    autoCapitalize="none"
                    onChangeText={setUsername}
                  />

                  <Text style={styles.label}>Display Name</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Your Name"
                    value={displayName}
                    onChangeText={setDisplayName}
                  />

                  <Text style={styles.label}>Role</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="user, admin, etc."
                    value={role}
                    onChangeText={setRole}
                  />
                </>
              )}

              <Text style={styles.label}>Password</Text>
              <TextInput
                style={styles.input}
                placeholder="••••••••"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />

              <TouchableOpacity
                style={styles.primaryButton}
                onPress={handleAuthSubmit}
                disabled={authLoading}
              >
                {authLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryButtonText}>
                    {isRegister ? 'Sign Up (Local SQLite)' : 'Sign In'}
                  </Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.linkButton}
                onPress={() => {
                  setIsRegister(!isRegister);
                  setMessage(null);
                }}
              >
                <Text style={styles.linkButtonText}>
                  {isRegister
                    ? 'Already have an account? Sign In'
                    : "Don't have an account? Register"}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      {/* TAB 2: RESET TOKEN FLOW */}
      {activeTab === 'reset' && (
        <View style={styles.card}>
          <Text style={styles.cardHeader}>🔑 Cryptographic Password Reset</Text>
          <Text style={styles.cardDescription}>
            Generates single-use 32-byte cryptographic tokens stored as SHA-256
            hashes in `_local_user_tokens`.
          </Text>

          <Text style={styles.label}>Email or Username to Reset</Text>
          <TextInput
            style={styles.input}
            placeholder="email@example.com or username"
            value={resetIdentifier}
            onChangeText={setResetIdentifier}
          />
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={handleGenerateResetToken}
          >
            <Text style={styles.secondaryButtonText}>Generate Reset Token</Text>
          </TouchableOpacity>

          {generatedToken ? (
            <View style={styles.tokenBox}>
              <Text style={styles.tokenLabel}>
                Generated Single-Use Token (Copy this):
              </Text>
              <Text style={styles.tokenVal} selectable>
                {generatedToken}
              </Text>
            </View>
          ) : null}

          <View style={styles.divider} />

          <Text style={styles.sectionSubtitle}>
            Redeem Token & Set New Password
          </Text>
          <Text style={styles.label}>Reset Token</Text>
          <TextInput
            style={styles.input}
            placeholder="Paste reset token hex"
            value={tokenInput}
            onChangeText={setTokenInput}
          />
          <Text style={styles.label}>New Password</Text>
          <TextInput
            style={styles.input}
            placeholder="New password"
            secureTextEntry
            value={resetNewPassword}
            onChangeText={setResetNewPassword}
          />
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handleRedeemResetToken}
          >
            <Text style={styles.primaryButtonText}>Redeem Token & Reset</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* TAB 3: LOCKOUT TEST */}
      {activeTab === 'lockout' && (
        <View style={styles.card}>
          <Text style={styles.cardHeader}>
            🛡️ Brute-Force & Lockout Protection
          </Text>
          <Text style={styles.cardDescription}>
            Configured max attempts: 3. Exceeding 3 consecutive wrong passwords
            automatically locks the account for 30 seconds.
          </Text>

          <Text style={styles.label}>Target Email</Text>
          <TextInput
            style={styles.input}
            placeholder="target@example.com"
            value={email}
            onChangeText={setEmail}
          />

          <TouchableOpacity
            style={[styles.dangerButton, { marginBottom: 12 }]}
            onPress={handleSimulateLockout}
          >
            <Text style={styles.dangerButtonText}>
              Simulate 3 Failed Logins (Trigger Lockout)
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={handleUnlockAccount}
          >
            <Text style={styles.secondaryButtonText}>Manual Admin Unlock</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* TAB 4: USERS DATABASE INSPECTOR */}
      {activeTab === 'users' && (
        <View style={styles.card}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <Text style={styles.cardHeader}>
              📂 SQLite `_local_users` Table
            </Text>
            <TouchableOpacity onPress={loadAllUsers} disabled={refreshingUsers}>
              <Text style={{ color: '#0284c7', fontWeight: 'bold' }}>
                {refreshingUsers ? 'Refreshing...' : 'Refresh'}
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.cardDescription}>
            Live sanitized contents of SQLite `_local_users` table. Passwords &
            salts remain private.
          </Text>

          {allUsers.length === 0 ? (
            <Text style={styles.emptyText}>No users registered yet.</Text>
          ) : (
            allUsers.map((u) => (
              <View key={u.id} style={styles.userItem}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.userItemTitle}>
                    {u.displayName || u.email}{' '}
                    <Text style={{ fontSize: 12, color: '#64748b' }}>
                      ({u.role})
                    </Text>
                  </Text>
                  <Text style={styles.userItemSub}>Email: {u.email}</Text>
                  <Text style={styles.userItemSub}>
                    Username: {u.username || '—'}
                  </Text>
                  <Text style={styles.userItemSub}>
                    Status: {u.status} | Failed Attempts:{' '}
                    {u.failedLoginAttempts}
                  </Text>
                  <Text style={styles.userItemSub}>
                    Created: {new Date(u.createdAt).toLocaleTimeString()}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.deleteUserButton}
                  onPress={async () => {
                    if (!client) return;
                    await client.auth.deleteUser(u.id);
                    loadAllUsers();
                    showToast(`User ${u.email} deleted.`);
                  }}
                >
                  <Text style={styles.deleteUserButtonText}>Delete</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: '#f8fafc',
    minHeight: '100%',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#64748b',
  },
  header: {
    marginBottom: 20,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#0f172a',
  },
  subtitle: {
    fontSize: 14,
    color: '#64748b',
    marginTop: 4,
  },
  badgeRow: {
    flexDirection: 'row',
    marginTop: 10,
    gap: 8,
    flexWrap: 'wrap',
  },
  badge: {
    backgroundColor: '#e2e8f0',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeSuccess: {
    backgroundColor: '#dcfce7',
  },
  badgeMuted: {
    backgroundColor: '#f1f5f9',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  alert: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  alertSuccess: {
    backgroundColor: '#dcfce7',
    borderColor: '#86efac',
    borderWidth: 1,
  },
  alertError: {
    backgroundColor: '#fee2e2',
    borderColor: '#fca5a5',
    borderWidth: 1,
  },
  alertText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1e293b',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#e2e8f0',
    borderRadius: 10,
    padding: 4,
    marginBottom: 16,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  tabButtonActive: {
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  tabButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
  },
  tabButtonTextActive: {
    color: '#0284c7',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 18,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
    marginBottom: 20,
  },
  cardHeader: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#0f172a',
    marginBottom: 6,
  },
  cardDescription: {
    fontSize: 13,
    color: '#64748b',
    marginBottom: 14,
    lineHeight: 18,
  },
  sectionSubtitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: 10,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 4,
    marginTop: 8,
  },
  input: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#0f172a',
    marginBottom: 6,
  },
  primaryButton: {
    backgroundColor: '#0284c7',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: '#f1f5f9',
    borderColor: '#cbd5e1',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  secondaryButtonText: {
    color: '#334155',
    fontSize: 14,
    fontWeight: '600',
  },
  dangerButton: {
    backgroundColor: '#ef4444',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  dangerButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  linkButton: {
    alignItems: 'center',
    marginTop: 12,
    paddingVertical: 6,
  },
  linkButtonText: {
    color: '#0284c7',
    fontSize: 14,
    fontWeight: '500',
  },
  infoRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  infoLabel: {
    width: 110,
    fontWeight: '600',
    color: '#64748b',
    fontSize: 14,
  },
  infoVal: {
    flex: 1,
    color: '#0f172a',
    fontSize: 14,
  },
  divider: {
    height: 1,
    backgroundColor: '#e2e8f0',
    marginVertical: 16,
  },
  tokenBox: {
    backgroundColor: '#f1f5f9',
    padding: 12,
    borderRadius: 8,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  tokenLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 4,
  },
  tokenVal: {
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: '#0369a1',
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  userItemTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0f172a',
  },
  userItemSub: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  deleteUserButton: {
    backgroundColor: '#fee2e2',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  deleteUserButtonText: {
    color: '#dc2626',
    fontSize: 12,
    fontWeight: '600',
  },
  emptyText: {
    color: '#94a3b8',
    textAlign: 'center',
    paddingVertical: 20,
    fontSize: 14,
  },
});
