import { createClient, type Session } from '@supabase/supabase-js';

export type CloudAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  text?: string;
};

export type CloudMessage = {
  role: 'user' | 'assistant';
  content: string;
  attachments?: CloudAttachment[];
};

export type CloudConversation = {
  id: string;
  title: string;
  updatedAt: number;
  messages: CloudMessage[];
};

export type LocalConversationForSync = CloudConversation & {
  sessionId?: string;
  executionLedger?: unknown;
  cognitiveCheckpoint?: unknown;
  knowledgeState?: unknown;
};

const SUPABASE_URL =
  import.meta.env.VITE_ULTRON_SUPABASE_URL ?? 'https://vshoxrtrfleptqxkrmtc.supabase.co';
const SUPABASE_KEY =
  import.meta.env.VITE_ULTRON_SUPABASE_PUBLISHABLE_KEY ??
  'sb_publishable_OuRYpP7YP76xv4mfUgd_ng_NF4nWVoV';

export const cloudClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
  realtime: {
    params: { eventsPerSecond: 8 },
  },
});

const ID_MAP_KEY = 'ultron.cloud.ids.v1';
const syncedConversationFingerprints = new Map<string, string>();
const syncedMessageFingerprints = new Map<string, string>();
let syncTimer: number | undefined;
let syncInFlight = false;
let syncQueued: LocalConversationForSync[] | null = null;

type IdMap = { conversations: Record<string, string>; messages: Record<string, string>; messageTimes: Record<string, string> };

function readIdMap(): IdMap {
  try {
    const value = JSON.parse(window.localStorage.getItem(ID_MAP_KEY) ?? '{}') as Partial<IdMap>;
    return {
      conversations: value.conversations ?? {},
      messages: value.messages ?? {},
      messageTimes: value.messageTimes ?? {},
    };
  } catch {
    return { conversations: {}, messages: {}, messageTimes: {} };
  }
}

function writeIdMap(value: IdMap): void {
  try {
    window.localStorage.setItem(ID_MAP_KEY, JSON.stringify(value));
  } catch {
    // The local chat remains usable; cloud sync will report an error if IDs cannot persist.
  }
}

function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function stableFingerprint(value: unknown): string {
  return JSON.stringify(value);
}

export async function getCloudSession(): Promise<Session | null> {
  const { data, error } = await cloudClient.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function signInToCloud(email: string, password: string): Promise<Session> {
  const { data, error } = await cloudClient.auth.signInWithPassword({ email, password });
  if (error) throw error;
  if (!data.session) throw new Error('Supabase did not return an authenticated session.');
  const { data: owner, error: ownerError } = await cloudClient
    .from('ultron_instance')
    .select('display_name')
    .eq('owner_id', data.session.user.id)
    .maybeSingle();
  if (ownerError) {
    await cloudClient.auth.signOut();
    throw ownerError;
  }
  if (!owner) {
    await cloudClient.auth.signOut();
    throw new Error('This account is not the registered owner of this ULTRON instance.');
  }
  return data.session;
}

export async function signOutOfCloud(): Promise<void> {
  const { error } = await cloudClient.auth.signOut();
  if (error) throw error;
}

export async function pullCloudWorkspace(): Promise<CloudConversation[]> {
  const session = await getCloudSession();
  if (!session) return [];

  const { data: rows, error: conversationError } = await cloudClient
    .from('ultron_conversations')
    .select('id,title,status,metadata,updated_at,last_message_at')
    .neq('status', 'deleted')
    .order('updated_at', { ascending: false })
    .limit(200);
  if (conversationError) throw conversationError;
  if (!rows?.length) return [];

  const conversationIds = rows.map((row) => row.id);
  const { data: messageRows, error: messageError } = await cloudClient
    .from('ultron_messages')
    .select('id,conversation_id,role,content,parts,metadata,created_at,sequence_no')
    .in('conversation_id', conversationIds)
    .order('sequence_no', { ascending: true })
    .limit(5000);
  if (messageError) throw messageError;

  const grouped = new Map<string, CloudMessage[]>();
  for (const row of messageRows ?? []) {
    if (row.role !== 'user' && row.role !== 'assistant') continue;
    const parts = Array.isArray(row.parts) ? row.parts : [];
    const attachments = parts
      .filter((part): part is Record<string, unknown> => Boolean(part) && typeof part === 'object' && (part as Record<string, unknown>).type === 'attachment')
      .map((part) => ({
        id: String(part.id ?? uuid()),
        name: String(part.name ?? 'Attachment'),
        type: String(part.mimeType ?? part.type ?? 'application/octet-stream'),
        size: Number(part.size ?? 0),
        ...(typeof part.text === 'string' ? { text: part.text } : {}),
      }));
    const list = grouped.get(row.conversation_id) ?? [];
    list.push({ role: row.role, content: row.content, ...(attachments.length ? { attachments } : {}) });
    grouped.set(row.conversation_id, list);
  }

  const idMap = readIdMap();
  return rows.map((row) => {
    const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata as Record<string, unknown> : {};
    const localId = typeof metadata.local_conversation_id === 'string'
      ? metadata.local_conversation_id
      : `cloud_${row.id}`;
    idMap.conversations[localId] = row.id;
    return {
      id: localId,
      title: row.title,
      updatedAt: new Date(row.last_message_at ?? row.updated_at).getTime(),
      messages: grouped.get(row.id) ?? [],
    };
  });
}

export function mergeCloudWorkspace(
  local: LocalConversationForSync[],
  remote: CloudConversation[],
): LocalConversationForSync[] {
  const merged = new Map(local.map((conversation) => [conversation.id, conversation]));
  for (const cloud of remote) {
    const existing = merged.get(cloud.id);
    if (!existing) {
      merged.set(cloud.id, cloud);
      continue;
    }
    const remoteIsNewer = cloud.updatedAt > existing.updatedAt;
    const count = Math.max(existing.messages.length, cloud.messages.length);
    const messages: CloudMessage[] = [];
    for (let index = 0; index < count; index += 1) {
      const localMessage = existing.messages[index];
      const remoteMessage = cloud.messages[index];
      if (localMessage && remoteMessage) messages.push(remoteIsNewer ? remoteMessage : localMessage);
      else if (localMessage) messages.push(localMessage);
      else if (remoteMessage) messages.push(remoteMessage);
    }
    merged.set(cloud.id, {
      ...existing,
      title: remoteIsNewer ? cloud.title : existing.title,
      updatedAt: Math.max(existing.updatedAt, cloud.updatedAt),
      messages,
    });
  }
  return [...merged.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

function markSynced(conversations: LocalConversationForSync[]): void {
  for (const conversation of conversations) {
    syncedConversationFingerprints.set(
      conversation.id,
      stableFingerprint({ title: conversation.title, updatedAt: conversation.updatedAt }),
    );
    conversation.messages.forEach((message, index) => {
      syncedMessageFingerprints.set(
        `${conversation.id}:${index}`,
        stableFingerprint({ role: message.role, content: message.content, attachments: message.attachments ?? [] }),
      );
    });
  }
}

export async function syncCloudWorkspace(conversations: LocalConversationForSync[]): Promise<void> {
  const session = await getCloudSession();
  if (!session) return;
  const idMap = readIdMap();

  for (const conversation of conversations) {
    const cloudId = idMap.conversations[conversation.id] ?? uuid();
    idMap.conversations[conversation.id] = cloudId;
    const conversationFingerprint = stableFingerprint({
      title: conversation.title,
      updatedAt: conversation.updatedAt,
    });
    const conversationChanged = syncedConversationFingerprints.get(conversation.id) !== conversationFingerprint;

    if (conversationChanged) {
      const timestamp = new Date(Math.max(0, conversation.updatedAt)).toISOString();
      const { error } = await cloudClient.from('ultron_conversations').upsert({
        id: cloudId,
        owner_id: session.user.id,
        title: conversation.title.slice(0, 180) || 'New conversation',
        status: 'active',
        last_message_at: conversation.messages.length ? timestamp : null,
        metadata: { local_conversation_id: conversation.id },
        updated_at: timestamp,
      }, { onConflict: 'id' });
      if (error) throw error;
      syncedConversationFingerprints.set(conversation.id, conversationFingerprint);
    }

    for (let index = 0; index < conversation.messages.length; index += 1) {
      const message = conversation.messages[index]!;
      const key = `${conversation.id}:${index}`;
      const fingerprint = stableFingerprint({
        role: message.role,
        content: message.content,
        attachments: message.attachments ?? [],
      });
      if (syncedMessageFingerprints.get(key) === fingerprint) continue;

      const messageId = idMap.messages[key] ?? uuid();
      idMap.messages[key] = messageId;
      const createdAt = idMap.messageTimes[key] ?? new Date(conversation.updatedAt).toISOString();
      idMap.messageTimes[key] = createdAt;
      const parts = (message.attachments ?? []).map((attachment) => ({
        type: 'attachment',
        id: attachment.id,
        name: attachment.name,
        mimeType: attachment.type,
        size: attachment.size,
        ...(attachment.text ? { text: attachment.text.slice(0, 100_000) } : {}),
      }));
      const { error } = await cloudClient.from('ultron_messages').upsert({
        id: messageId,
        owner_id: session.user.id,
        conversation_id: cloudId,
        role: message.role,
        content: message.content,
        parts,
        metadata: { local_message_index: index, local_conversation_id: conversation.id },
        created_at: createdAt,
        status: 'complete',
      }, { onConflict: 'id' });
      if (error) throw error;
      syncedMessageFingerprints.set(key, fingerprint);
    }
  }

  writeIdMap(idMap);
}

export function scheduleCloudSync(conversations: LocalConversationForSync[]): void {
  syncQueued = conversations;
  if (syncTimer) window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => {
    if (syncInFlight || !syncQueued) return;
    const queued = syncQueued;
    syncQueued = null;
    syncInFlight = true;
    void syncCloudWorkspace(queued)
      .catch((error) => console.warn('[ULTRON cloud sync]', error))
      .finally(() => {
        syncInFlight = false;
        if (syncQueued) scheduleCloudSync(syncQueued);
      });
  }, 1200);
}

export function subscribeCloudWorkspace(onChange: () => void): () => void {
  let ownerId = '';
  let active = true;
  void getCloudSession().then((session) => {
    if (!active || !session) return;
    ownerId = session.user.id;
    const channel = cloudClient
      .channel('ultron-private-workspace')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ultron_conversations', filter: `owner_id=eq.${ownerId}` }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ultron_messages', filter: `owner_id=eq.${ownerId}` }, onChange)
      .subscribe();
    unsubscribeChannel = () => { void cloudClient.removeChannel(channel); };
  }).catch((error) => console.warn('[ULTRON realtime]', error));

  let unsubscribeChannel = (): void => undefined;
  return () => {
    active = false;
    unsubscribeChannel();
  };
}

export function rememberCloudWorkspace(conversations: LocalConversationForSync[]): void {
  markSynced(conversations);
}
