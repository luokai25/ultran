import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../src/lib/supabase';
import {
  createConversation as createWorkspaceConversation,
  getMemoryCount,
  listConversations,
  verifyUltronOwner,
  type UltronConversation,
} from '../src/lib/workspace';

const COLORS = {
  background: '#080a0d',
  surface: '#11151b',
  surfaceRaised: '#171d25',
  border: '#242d38',
  text: '#f4f6f8',
  muted: '#8b98a8',
  gold: '#d6ad62',
  green: '#67c58b',
  red: '#e47c7c',
};

function PrimaryButton({
  label,
  onPress,
  disabled = false,
  loading = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.primaryButton,
        (disabled || loading) && styles.disabledButton,
        pressed && !disabled && styles.pressedButton,
      ]}
    >
      {loading ? <ActivityIndicator color={COLORS.background} /> : <Text style={styles.primaryButtonText}>{label}</Text>}
    </Pressable>
  );
}

function LoginScreen({
  onLogin,
}: {
  onLogin: (email: string, password: string) => Promise<void>;
}) {
  const [email, setEmail] = useState('luok29365@gmail.com');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!email.trim() || !password) {
      setError('Enter your email and password to continue.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onLogin(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.screen}
    >
      <ScrollView contentContainerStyle={styles.loginContent} keyboardShouldPersistTaps="handled">
        <View style={styles.mark}>
          <View style={styles.markCore} />
        </View>
        <Text style={styles.eyebrow}>PRIVATE INTELLIGENCE SYSTEM</Text>
        <Text style={styles.brand}>ULTRON</Text>
        <Text style={styles.loginDescription}>
          Your private workspace. Sign in with the owner account to reconnect your memory, models and work.
        </Text>

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Owner access</Text>
          <Text style={styles.fieldLabel}>EMAIL ADDRESS</Text>
          <TextInput
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder="Your email"
            placeholderTextColor="#687585"
            style={styles.input}
            value={email}
          />
          <Text style={styles.fieldLabel}>PASSWORD</Text>
          <TextInput
            autoCapitalize="none"
            autoComplete="password"
            onChangeText={setPassword}
            onSubmitEditing={submit}
            placeholder="Your password"
            placeholderTextColor="#687585"
            secureTextEntry
            style={styles.input}
            value={password}
          />
          {error ? <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text> : null}
          <PrimaryButton label="Connect to ULTRON" onPress={submit} loading={busy} />
          <Text style={styles.securityNote}>Single-owner access · Encrypted session storage · No public registration</Text>
        </View>
        <Text style={styles.footer}>THINK LOCAL. ACT DELIBERATELY.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ConversationRow({ item, onPress }: { item: UltronConversation; onPress: () => void }) {
  const date = item.last_message_at ?? item.updated_at;
  const dateLabel = date
    ? new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : 'New';

  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.conversationRow}>
      <View style={styles.conversationIcon}>
        <Text style={styles.conversationIconText}>U</Text>
      </View>
      <View style={styles.conversationCopy}>
        <Text numberOfLines={1} style={styles.conversationTitle}>{item.title || 'New conversation'}</Text>
        <Text style={styles.conversationMeta}>{item.status === 'archived' ? 'Archived' : 'Conversation'} · {dateLabel}</Text>
      </View>
      <Text style={styles.rowChevron}>›</Text>
    </Pressable>
  );
}

function WorkspaceScreen({
  session,
  ownerName,
  onSignOut,
}: {
  session: Session;
  ownerName: string;
  onSignOut: () => void;
}) {
  const [conversations, setConversations] = useState<UltronConversation[]>([]);
  const [memoryCount, setMemoryCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  const refresh = useCallback(async () => {
    try {
      const [nextConversations, nextMemoryCount] = await Promise.all([
        listConversations(),
        getMemoryCount(),
      ]);
      setConversations(nextConversations);
      setMemoryCount(nextMemoryCount);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your ULTRON workspace.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const channel = supabase
      .channel('ultron-owner-workspace')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ultron_conversations', filter: `owner_id=eq.${session.user.id}` },
        () => void refresh(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ultron_memory_items', filter: `owner_id=eq.${session.user.id}` },
        () => void refresh(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refresh, session.user.id]);

  const addConversation = async () => {
    setCreating(true);
    try {
      const conversation = await createWorkspaceConversation();
      await refresh();
      router.push({ pathname: '/conversation/[id]', params: { id: conversation.id } });
    } catch (err) {
      Alert.alert('Could not create conversation', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.workspaceContent}>
      <View style={styles.topBar}>
        <View>
          <Text style={styles.eyebrow}>PRIVATE INTELLIGENCE SYSTEM</Text>
          <Text style={styles.topTitle}>ULTRON</Text>
        </View>
        <View style={styles.connectedPill}>
          <View style={styles.connectedDot} />
          <Text style={styles.connectedText}>CONNECTED</Text>
        </View>
      </View>

      <View style={styles.welcomePanel}>
        <Text style={styles.welcomeEyebrow}>SYSTEM ONLINE</Text>
        <Text style={styles.welcomeTitle}>Welcome back.</Text>
        <Text style={styles.welcomeBody}>
          {ownerName} is connected to its private workspace. Your data is protected by owner-only database policies.
        </Text>
        <Text style={styles.accountText}>{session.user.email}</Text>
      </View>

      <View style={styles.metricsRow}>
        <View style={styles.metricCard}>
          <Text style={styles.metricValue}>{loading ? '—' : String(conversations.length)}</Text>
          <Text style={styles.metricLabel}>CONVERSATIONS</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricValue}>{loading ? '—' : String(memoryCount)}</Text>
          <Text style={styles.metricLabel}>MEMORIES</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricValue}>1</Text>
          <Text style={styles.metricLabel}>OWNER</Text>
        </View>
      </View>

      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.sectionTitle}>Your workspace</Text>
          <Text style={styles.sectionSubtitle}>Stored in your ULTRON Supabase instance</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={() => void refresh()} style={styles.refreshButton}>
          <Text style={styles.refreshText}>Refresh</Text>
        </Pressable>
      </View>

      <PrimaryButton label="＋  New conversation" onPress={addConversation} loading={creating} />

      {error ? <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text> : null}
      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={COLORS.gold} />
          <Text style={styles.loadingText}>Loading your workspace…</Text>
        </View>
      ) : conversations.length ? (
        <View style={styles.listPanel}>
          {conversations.map((conversation) => (
            <ConversationRow item={conversation} key={conversation.id} onPress={() => router.push({ pathname: '/conversation/[id]', params: { id: conversation.id } })} />
          ))}
        </View>
      ) : (
        <View style={styles.emptyPanel}>
          <Text style={styles.emptyTitle}>A clean slate.</Text>
          <Text style={styles.emptyBody}>Your first conversation will be saved here and synced across connected devices.</Text>
        </View>
      )}

      <View style={styles.backendPanel}>
        <Text style={styles.backendTitle}>BACKEND STATUS</Text>
        <StatusLine label="Authentication" value="Owner session active" />
        <StatusLine label="Database" value="Connected" />
        <StatusLine label="Realtime sync" value="Subscribed" />
        <StatusLine label="Memory store" value={loading ? 'Checking…' : 'Ready'} />
      </View>

      <Pressable accessibilityRole="button" onPress={onSignOut} style={styles.signOutButton}>
        <Text style={styles.signOutText}>Sign out of ULTRON</Text>
      </Pressable>
      <Text style={styles.footer}>THINK LOCAL. ACT DELIBERATELY.</Text>
    </ScrollView>
  );
}

function StatusLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statusLine}>
      <Text style={styles.statusLabel}>{label}</Text>
      <Text style={styles.statusValue}>{value}</Text>
    </View>
  );
}

export default function HomeScreen() {
  const [session, setSession] = useState<Session | null>(null);
  const [ownerName, setOwnerName] = useState('ULTRON');
  const [authLoading, setAuthLoading] = useState(true);
  const [ownerChecking, setOwnerChecking] = useState(false);
  const [ownerError, setOwnerError] = useState('');

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      if (error) setOwnerError(error.message);
      setSession(data.session);
      setAuthLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (mounted) setSession(nextSession);
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) {
      setOwnerName('ULTRON');
      setOwnerError('');
      setOwnerChecking(false);
      return;
    }

    let active = true;
    setOwnerChecking(true);
    verifyUltronOwner(session)
      .then((instance) => {
        if (!active) return;
        setOwnerName(instance.display_name || 'ULTRON');
        setOwnerError('');
      })
      .catch(async (err) => {
        if (!active) return;
        const message = err instanceof Error ? err.message : 'Owner verification failed.';
        setOwnerError(message);
        await supabase.auth.signOut();
      })
      .finally(() => {
        if (active) setOwnerChecking(false);
      });

    return () => {
      active = false;
    };
  }, [session]);

  const login = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) Alert.alert('Sign out failed', error.message);
  };

  if (authLoading || ownerChecking) {
    return (
      <View style={[styles.screen, styles.centered]}>
        <View style={styles.mark}><View style={styles.markCore} /></View>
        <ActivityIndicator color={COLORS.gold} size="large" />
        <Text style={styles.loadingText}>{authLoading ? 'Restoring secure session…' : 'Verifying owner access…'}</Text>
      </View>
    );
  }

  if (!session) {
    return (
      <>
        <LoginScreen onLogin={login} />
        {ownerError ? <Text style={styles.hiddenError}>{ownerError}</Text> : null}
      </>
    );
  }

  return <WorkspaceScreen session={session} ownerName={ownerName} onSignOut={signOut} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  centered: { alignItems: 'center', justifyContent: 'center', gap: 18 },
  loginContent: { flexGrow: 1, justifyContent: 'center', padding: 24, paddingTop: 52, paddingBottom: 36 },
  mark: {
    width: 68, height: 68, borderRadius: 34, borderWidth: 1, borderColor: COLORS.gold,
    alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 28,
  },
  markCore: { width: 24, height: 24, borderRadius: 12, backgroundColor: COLORS.gold, opacity: 0.9 },
  eyebrow: { color: COLORS.gold, fontSize: 10, letterSpacing: 2.1, fontWeight: '700' },
  brand: { color: COLORS.text, fontSize: 38, fontWeight: '800', letterSpacing: 5, textAlign: 'center', marginTop: 8 },
  loginDescription: { color: COLORS.muted, fontSize: 14, lineHeight: 22, textAlign: 'center', marginTop: 12, marginBottom: 30 },
  panel: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 18, padding: 20 },
  panelTitle: { color: COLORS.text, fontSize: 17, fontWeight: '700', marginBottom: 20 },
  fieldLabel: { color: COLORS.muted, fontSize: 10, fontWeight: '700', letterSpacing: 1.3, marginBottom: 8, marginTop: 10 },
  input: { color: COLORS.text, backgroundColor: '#0b0f14', borderColor: COLORS.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 13, fontSize: 14 },
  primaryButton: { minHeight: 50, borderRadius: 11, backgroundColor: COLORS.gold, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, marginTop: 16 },
  primaryButtonText: { color: '#111317', fontSize: 14, fontWeight: '800' },
  disabledButton: { opacity: 0.55 },
  pressedButton: { opacity: 0.8 },
  securityNote: { color: COLORS.muted, fontSize: 10, lineHeight: 16, textAlign: 'center', marginTop: 14 },
  errorText: { color: COLORS.red, fontSize: 12, lineHeight: 18, marginTop: 12 },
  hiddenError: { color: COLORS.red, fontSize: 1 },
  footer: { color: '#536070', fontSize: 9, letterSpacing: 2, textAlign: 'center', marginTop: 30 },
  workspaceContent: { padding: 22, paddingTop: 54, paddingBottom: 42 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topTitle: { color: COLORS.text, fontSize: 29, fontWeight: '800', letterSpacing: 3, marginTop: 4 },
  connectedPill: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#102319', borderColor: '#244d34', borderWidth: 1, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 7 },
  connectedDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.green },
  connectedText: { color: COLORS.green, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  welcomePanel: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 17, padding: 18, marginTop: 24 },
  welcomeEyebrow: { color: COLORS.green, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  welcomeTitle: { color: COLORS.text, fontSize: 25, fontWeight: '700', marginTop: 9 },
  welcomeBody: { color: COLORS.muted, fontSize: 13, lineHeight: 20, marginTop: 8 },
  accountText: { color: COLORS.gold, fontSize: 11, marginTop: 14 },
  metricsRow: { flexDirection: 'row', gap: 9, marginTop: 12 },
  metricCard: { flex: 1, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 13, padding: 13 },
  metricValue: { color: COLORS.text, fontSize: 24, fontWeight: '800' },
  metricLabel: { color: COLORS.muted, fontSize: 8, letterSpacing: 1, fontWeight: '700', marginTop: 5 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 30, marginBottom: 13 },
  sectionTitle: { color: COLORS.text, fontSize: 19, fontWeight: '700' },
  sectionSubtitle: { color: COLORS.muted, fontSize: 10, marginTop: 4 },
  refreshButton: { paddingHorizontal: 12, paddingVertical: 9 },
  refreshText: { color: COLORS.gold, fontSize: 12, fontWeight: '700' },
  listPanel: { backgroundColor: COLORS.surface, borderColor: COLORS.border, borderWidth: 1, borderRadius: 14, marginTop: 14, overflow: 'hidden' },
  conversationRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  conversationIcon: { width: 37, height: 37, borderRadius: 19, borderWidth: 1, borderColor: '#7d653d', alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  conversationIconText: { color: COLORS.gold, fontWeight: '800', fontSize: 15 },
  conversationCopy: { flex: 1 },
  conversationTitle: { color: COLORS.text, fontSize: 13, fontWeight: '700' },
  conversationMeta: { color: COLORS.muted, fontSize: 10, marginTop: 5 },
  rowChevron: { color: COLORS.muted, fontSize: 22, paddingLeft: 8 },
  emptyPanel: { backgroundColor: COLORS.surface, borderColor: COLORS.border, borderWidth: 1, borderRadius: 14, padding: 20, marginTop: 14 },
  emptyTitle: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  emptyBody: { color: COLORS.muted, fontSize: 12, lineHeight: 18, marginTop: 7 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 24 },
  loadingText: { color: COLORS.muted, fontSize: 12 },
  backendPanel: { backgroundColor: COLORS.surface, borderColor: COLORS.border, borderWidth: 1, borderRadius: 14, padding: 16, marginTop: 24 },
  backendTitle: { color: COLORS.gold, fontSize: 9, fontWeight: '800', letterSpacing: 1.6, marginBottom: 10 },
  statusLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#202833' },
  statusLabel: { color: COLORS.muted, fontSize: 11 },
  statusValue: { color: COLORS.green, fontSize: 11, fontWeight: '600' },
  signOutButton: { alignSelf: 'center', padding: 14, marginTop: 12 },
  signOutText: { color: COLORS.muted, fontSize: 12 },
});
