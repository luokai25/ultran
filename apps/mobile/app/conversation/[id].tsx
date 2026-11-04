import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import {
  getConversation,
  listMessages,
  saveUserMessage,
  type UltronConversation,
  type UltronMessage,
} from '../../src/lib/workspace';

const GOLD = '#d6ad62';
const TEXT = '#f4f6f8';
const MUTED = '#8b98a8';

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const [conversation, setConversation] = useState<UltronConversation | null>(null);
  const [messages, setMessages] = useState<UltronMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!id) return;
    try {
      const [nextConversation, nextMessages] = await Promise.all([
        getConversation(id),
        listMessages(id),
      ]);
      setConversation(nextConversation);
      setMessages(nextMessages);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this conversation.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void refresh();
    if (!id) return;

    const channel = supabase
      .channel(`ultron-conversation-${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ultron_messages', filter: `conversation_id=eq.${id}` },
        () => void refresh(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [id, refresh]);

  useEffect(() => {
    if (messages.length) {
      scrollRef.current?.scrollToEnd({ animated: true });
    }
  }, [messages.length]);

  const send = async () => {
    const value = draft.trim();
    if (!value || sending || !id) return;
    setSending(true);
    setError('');
    setDraft('');
    try {
      const saved = await saveUserMessage(id, value);
      setMessages((current) =>
        current.some((message) => message.id === saved.id) ? current : [...current, saved],
      );
    } catch (err) {
      setDraft(value);
      setError(err instanceof Error ? err.message : 'Message could not be saved.');
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
    >
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View style={styles.headerCopy}>
          <Text numberOfLines={1} style={styles.headerTitle}>{conversation?.title ?? 'Conversation'}</Text>
          <Text style={styles.headerSubtitle}>PRIVATE · SYNCED</Text>
        </View>
        <View style={styles.liveDot} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={GOLD} />
          <Text style={styles.muted}>Loading conversation…</Text>
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          style={styles.messageScroll}
          contentContainerStyle={styles.messageContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>ULTRON MEMORY LINK ACTIVE</Text>
            <Text style={styles.noticeBody}>
              Messages are being saved to your private workspace and synchronized in real time. The model-response bridge is the next integration step.
            </Text>
          </View>

          {messages.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>Start a conversation.</Text>
              <Text style={styles.muted}>Your messages will remain available when you sign in on another connected device.</Text>
            </View>
          ) : (
            messages.map((message) => (
              <View
                key={message.id}
                style={[
                  styles.messageRow,
                  message.role === 'user' ? styles.userRow : styles.assistantRow,
                ]}
              >
                <View style={[styles.bubble, message.role === 'user' ? styles.userBubble : styles.assistantBubble]}>
                  {message.role !== 'user' ? <Text style={styles.roleLabel}>{message.role.toUpperCase()}</Text> : null}
                  <Text style={styles.messageText}>{message.content}</Text>
                  <Text style={styles.messageTime}>
                    {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
              </View>
            ))
          )}
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        </ScrollView>
      )}

      <View style={styles.composer}>
        <TextInput
          multiline
          maxLength={12000}
          onChangeText={setDraft}
          placeholder="Write a message…"
          placeholderTextColor="#687585"
          style={styles.input}
          value={draft}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save message"
          disabled={!draft.trim() || sending || loading}
          onPress={() => void send()}
          style={[styles.sendButton, (!draft.trim() || sending || loading) && styles.sendDisabled]}
        >
          {sending ? <ActivityIndicator color="#111317" /> : <Text style={styles.sendText}>↑</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#080a0d' },
  header: { minHeight: 66, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#242d38' },
  backButton: { width: 42, height: 44, justifyContent: 'center' },
  backText: { color: GOLD, fontSize: 34, lineHeight: 38 },
  headerCopy: { flex: 1, paddingRight: 12 },
  headerTitle: { color: TEXT, fontSize: 15, fontWeight: '700' },
  headerSubtitle: { color: MUTED, fontSize: 9, letterSpacing: 1.5, marginTop: 4 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#67c58b' },
  messageScroll: { flex: 1 },
  messageContent: { padding: 16, paddingBottom: 24, flexGrow: 1 },
  notice: { backgroundColor: '#15130e', borderColor: '#59482b', borderWidth: 1, borderRadius: 12, padding: 13, marginBottom: 20 },
  noticeTitle: { color: GOLD, fontSize: 9, fontWeight: '800', letterSpacing: 1.4 },
  noticeBody: { color: '#b9ad97', fontSize: 11, lineHeight: 17, marginTop: 6 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, minHeight: 220 },
  emptyTitle: { color: TEXT, fontSize: 19, fontWeight: '700', marginBottom: 8 },
  muted: { color: MUTED, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  messageRow: { width: '100%', marginBottom: 12, flexDirection: 'row' },
  userRow: { justifyContent: 'flex-end' },
  assistantRow: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '88%', borderRadius: 15, paddingHorizontal: 14, paddingVertical: 11 },
  userBubble: { backgroundColor: '#4c3c22', borderBottomRightRadius: 4 },
  assistantBubble: { backgroundColor: '#171d25', borderColor: '#28313d', borderWidth: 1, borderBottomLeftRadius: 4 },
  roleLabel: { color: GOLD, fontSize: 9, fontWeight: '800', letterSpacing: 1.2, marginBottom: 6 },
  messageText: { color: TEXT, fontSize: 14, lineHeight: 21 },
  messageTime: { color: '#a69b87', fontSize: 9, textAlign: 'right', marginTop: 7 },
  error: { color: '#e47c7c', fontSize: 12, padding: 10 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 13, paddingTop: 10, paddingBottom: Platform.OS === 'ios' ? 22 : 12, borderTopWidth: 1, borderTopColor: '#242d38', backgroundColor: '#0c1015' },
  input: { flex: 1, minHeight: 46, maxHeight: 130, color: TEXT, backgroundColor: '#171d25', borderColor: '#29323e', borderWidth: 1, borderRadius: 13, paddingHorizontal: 13, paddingTop: 12, paddingBottom: 10, fontSize: 14 },
  sendButton: { width: 46, height: 46, borderRadius: 13, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center' },
  sendDisabled: { opacity: 0.45 },
  sendText: { color: '#111317', fontSize: 24, fontWeight: '800' },
});
