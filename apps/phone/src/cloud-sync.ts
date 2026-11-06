import { mergeCloudWorkspace, type CloudConversation, type CloudMessage, type LocalConversationForSync } from './cloud-workspace';
export { mergeCloudWorkspace, type CloudAttachment, type CloudConversation, type CloudMessage, type LocalConversationForSync } from './cloud-workspace';
import { createClient, type Session } from '@supabase/supabase-js';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { fetchAllPages } from './cloud-pagination';


export const ULTRON_SUPABASE_URL =
  import.meta.env.VITE_ULTRON_SUPABASE_URL ?? 'https://vshoxrtrfleptqxkrmtc.supabase.co';
export const ULTRON_SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_ULTRON_SUPABASE_PUBLISHABLE_KEY ??
  'sb_publishable_OuRYpP7YP76xv4mfUgd_ng_NF4nWVoV';

type UltronSecureStoragePlugin = {
  get(options: { key: string }): Promise<{ value: string | null }>;
  set(options: { key: string; value: string }): Promise<{ stored: boolean }>;
  remove(options: { key: string }): Promise<{ removed: boolean }>;
};

const NativeSecureStorage = registerPlugin<UltronSecureStoragePlugin>('UltronSecureStorage');

const secureSessionStorage = {
  async getItem(key: string): Promise<string | null> {
    if (Capacitor.getPlatform() === 'android') {
      const result = await NativeSecureStorage.get({ key });
      return result.value;
    }
    return window.localStorage.getItem(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    if (Capacitor.getPlatform() === 'android') {
      await NativeSecureStorage.set({ key, value });
      return;
    }
    window.localStorage.setItem(key, value);
  },
  async removeItem(key: string): Promise<void> {
    if (Capacitor.getPlatform() === 'android') {
      await NativeSecureStorage.remove({ key });
      return;
    }
    window.localStorage.removeItem(key);
  },
};

export const cloudClient = createClient(ULTRON_SUPABASE_URL, ULTRON_SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: secureSessionStorage,
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

type IdMap = { conversations: Record<string, string>; messages: Record<string, string>; messageTimes: Record<string, string>; memories: Record<string, string> };

function readIdMap(): IdMap {
  try {
    const value = JSON.parse(window.localStorage.getItem(ID_MAP_KEY) ?? '{}') as Partial<IdMap>;
    return {
      conversations: value.conversations ?? {},
      messages: value.messages ?? {},
      messageTimes: value.messageTimes ?? {},
      memories: value.memories ?? {},
    };
  } catch {
    return { conversations: {}, messages: {}, messageTimes: {}, memories: {} };
  }
}

export function getCloudConversationId(localConversationId: string): string | null { return readIdMap().conversations[localConversationId] ?? null; }

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

let sessionRefreshInFlight: Promise<Session | null> | null = null;

/** Return a usable owner session, refreshing before expiry so long-lived web/PWA
 * tabs and Android WebViews do not keep sending stale bearer tokens. Refreshes
 * are coalesced because chat, realtime and the key screen can wake together. */
export async function getCloudSession(): Promise<Session | null> {
  const { data, error } = await cloudClient.auth.getSession();
  if (error) throw error;
  const session = data.session;
  if (!session) return null;
  const expiresAt = Number(session.expires_at ?? 0);
  if (!expiresAt || expiresAt > Math.floor(Date.now() / 1000) + 90) return session;
  if (!sessionRefreshInFlight) {
    sessionRefreshInFlight = cloudClient.auth.refreshSession()
      .then(({ data: refreshed, error: refreshError }) => {
        if (refreshError) throw refreshError;
        return refreshed.session;
      })
      .finally(() => { sessionRefreshInFlight = null; });
  }
  return sessionRefreshInFlight;
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
    .order('updated_at', { ascending: false })
    .limit(200);
  if (conversationError) throw conversationError;
  if (!rows?.length) return [];

  const conversationIds = rows.map((row) => row.id);
  type CloudMessageRow = {
    id: string;
    conversation_id: string;
    role: string;
    content: string;
    parts: unknown;
    metadata: unknown;
    created_at: string;
    sequence_no: number;
  };
  const messageRows: CloudMessageRow[] = [];
  // Keep each IN clause small and page below PostgREST's default row cap.
  for (let index = 0; index < conversationIds.length; index += 100) {
    const conversationBatch = conversationIds.slice(index, index + 100);
    const batchRows = await fetchAllPages(async (from, to) => {
      const { data, error } = await cloudClient
        .from('ultron_messages')
        .select('id,conversation_id,role,content,parts,metadata,created_at,sequence_no')
        .in('conversation_id', conversationBatch)
        .order('conversation_id', { ascending: true })
        .order('sequence_no', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to);
      if (error) throw error;
      return data ?? [];
    }, 500);
    messageRows.push(...batchRows);
  }

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
    const metadata = row.metadata && typeof row.metadata === 'object'
      ? row.metadata as Record<string, unknown>
      : {};
    const localMessageId = typeof metadata.local_message_id === 'string'
      ? metadata.local_message_id
      : `cloud_${row.id}`;
    const list = grouped.get(row.conversation_id) ?? [];
    list.push({ id: localMessageId, sequenceNo: Number(row.sequence_no), role: row.role, content: row.content, ...(attachments.length ? { attachments } : {}) });
    grouped.set(row.conversation_id, list);
  }

  const idMap = readIdMap();
  const pulled = rows.map((row) => {
    const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata as Record<string, unknown> : {};
    const localId = typeof metadata.local_conversation_id === 'string'
      ? metadata.local_conversation_id
      : `cloud_${row.id}`;
    idMap.conversations[localId] = row.id;
    const messages = grouped.get(row.id) ?? [];
    const sourceRows = (messageRows ?? []).filter((item) =>
      item.conversation_id === row.id && (item.role === 'user' || item.role === 'assistant'),
    );
    messages.forEach((message, index) => {
      const localMessageId = message.id ?? `cloud_${sourceRows[index]?.id ?? index}`;
      const localKey = `${localId}:${localMessageId}`;
      const sourceRow = sourceRows[index];
      if (sourceRow) {
        idMap.messages[localKey] = sourceRow.id;
        idMap.messageTimes[localKey] = sourceRow.created_at;
      }
    });
    return {
      id: localId,
      title: row.title,
      updatedAt: new Date(row.last_message_at ?? row.updated_at).getTime(),
      messages,
      deleted: row.status === 'deleted',
    };
  });
  writeIdMap(idMap);
  return pulled;
}


function markSynced(conversations: LocalConversationForSync[]): void {
  for (const conversation of conversations) {
    syncedConversationFingerprints.set(
      conversation.id,
      stableFingerprint({ title: conversation.title, updatedAt: conversation.updatedAt }),
    );
    conversation.messages.forEach((message, index) => {
      syncedMessageFingerprints.set(
        `${conversation.id}:${message.id ?? index}`,
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
      const localMessageId = message.id ?? `local-index-${index}`;
      const key = `${conversation.id}:${localMessageId}`;
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
      writeIdMap(idMap);
      const parts = (message.attachments ?? []).map((attachment) => ({
        type: 'attachment',
        id: attachment.id,
        name: attachment.name,
        mimeType: attachment.type,
        size: attachment.size,
        ...(attachment.text ? { text: attachment.text.slice(0, 100_000) } : {}),
      }));
      const { data: savedMessage, error } = await cloudClient.from('ultron_messages').upsert({
        id: messageId,
        owner_id: session.user.id,
        conversation_id: cloudId,
        role: message.role,
        content: message.content,
        parts,
        metadata: { local_message_id: localMessageId, local_message_index: index, local_conversation_id: conversation.id },
        created_at: createdAt,
        status: 'complete',
      }, { onConflict: 'id' }).select('sequence_no').single();
      if (error) throw error;
      message.sequenceNo = Number(savedMessage.sequence_no);
      syncedMessageFingerprints.set(key, fingerprint);
    }
  }

  writeIdMap(idMap);
}

export function scheduleCloudSync(
  conversations: LocalConversationForSync[],
  onError?: (error: unknown) => void,
): void {
  syncQueued = conversations;
  if (syncTimer) window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => {
    if (syncInFlight || !syncQueued) return;
    const queued = syncQueued;
    syncQueued = null;
    syncInFlight = true;
    void syncCloudWorkspace(queued)
      .catch((error) => {
        console.warn('[ULTRON cloud sync]', error);
        onError?.(error);
      })
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ultron_memory_items', filter: `owner_id=eq.${ownerId}` }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ultron_settings', filter: `owner_id=eq.${ownerId}` }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ultron_agent_runs', filter: `owner_id=eq.${ownerId}` }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ultron_generated_tools', filter: `owner_id=eq.${ownerId}` }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ultron_capability_proposals', filter: `owner_id=eq.${ownerId}` }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ultron_capability_events', filter: `owner_id=eq.${ownerId}` }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ultron_jobs', filter: `owner_id=eq.${ownerId}` }, onChange)
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

export async function deleteCloudConversation(localConversationId: string): Promise<void> {
  const session = await getCloudSession();
  if (!session) return;
  const cloudId = readIdMap().conversations[localConversationId];
  if (!cloudId) return;
  const { error } = await cloudClient
    .from('ultron_conversations')
    .update({ status: 'deleted' })
    .eq('id', cloudId)
    .eq('owner_id', session.user.id);
  if (error) throw error;
}

export type CloudMemoryRecord = {
  id: string;
  text: string;
  kind: string;
  source: string;
  confidence: number;
  updatedAt: number;
  accessedAt: number;
  accessCount: number;
  tier: string;
  vector: number[];
  fingerprint: string;
};

const syncedMemoryFingerprints = new Map<string, string>();
let memorySyncTimer: number | undefined;
const settingsSyncTimers = new Map<string, number>();
const syncedSettingFingerprints = new Map<string, string>();

function memoryFingerprint(record: CloudMemoryRecord): string {
  return stableFingerprint({
    text: record.text,
    kind: record.kind,
    source: record.source,
    confidence: record.confidence,
    updatedAt: record.updatedAt,
    vector: record.vector,
  });
}

export async function pullCloudMemories(): Promise<Array<{
  id: string;
  text: string;
  kind: string;
  source: string;
  sourceRef?: string;
  summary?: string;
  confidence: number;
  updatedAt: number;
}>> {
  const session = await getCloudSession();
  if (!session) return [];
  const data = await fetchAllPages(async (from, to) => {
    const { data: page, error } = await cloudClient
      .from('ultron_memory_items')
      .select('id,memory_type,content,summary,confidence,source,source_ref,metadata,updated_at')
      .is('archived_at', null)
      .order('updated_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to);
    if (error) throw error;
    return page ?? [];
  }, 500);

  const idMap = readIdMap();
  const memories = (data ?? []).map((row) => {
    const metadata = row.metadata && typeof row.metadata === 'object'
      ? row.metadata as Record<string, unknown>
      : {};
    const localId = typeof metadata.local_memory_id === 'string'
      ? metadata.local_memory_id
      : `cloud_${row.id}`;
    idMap.memories[localId] = row.id;
    return {
      id: localId,
      text: row.content,
      kind: row.memory_type,
      source: row.source ?? 'cloud',
      sourceRef: typeof row.source_ref === 'string' ? row.source_ref : undefined,
      summary: typeof row.summary === 'string' ? row.summary : undefined,
      confidence: Number(row.confidence ?? 0.8),
      updatedAt: new Date(row.updated_at).getTime(),
    };
  });
  writeIdMap(idMap);
  return memories;
}

export async function pullCloudMemoryRelations(): Promise<Array<{
  id: string;
  sourceId: string;
  targetId: string;
  relation: string;
  weight: number;
}>> {
  const session = await getCloudSession();
  if (!session) return [];
  const data = await fetchAllPages(async (from, to) => {
    const { data: page, error } = await cloudClient
      .from('ultron_memory_relations')
      .select('id,source_memory_id,target_memory_id,relation_type,weight')
      .order('created_at', { ascending: true })
      .range(from, to);
    if (error) throw error;
    return page ?? [];
  }, 500);
  const idMap = readIdMap();
  const reverse = new Map(Object.entries(idMap.memories).map(([localId, cloudId]) => [cloudId, localId]));
  return (data ?? []).map((row) => ({
    id: String(row.id),
    sourceId: reverse.get(String(row.source_memory_id)) ?? `cloud_${row.source_memory_id}`,
    targetId: reverse.get(String(row.target_memory_id)) ?? `cloud_${row.target_memory_id}`,
    relation: String(row.relation_type ?? "related_to"),
    weight: Number(row.weight ?? 0.7),
  }));
}

export async function syncCloudMemories(records: CloudMemoryRecord[]): Promise<void> {
  const session = await getCloudSession();
  if (!session) return;
  const idMap = readIdMap();
  const allowedTypes = new Set(['identity', 'preference', 'fact', 'episodic', 'semantic', 'goal', 'decision', 'procedure', 'relationship']);
  const pending: Array<{ localId: string; fingerprint: string; row: Record<string, unknown> }> = [];

  for (const record of records) {
    if (!record.text.trim()) continue;
    const cloudId = idMap.memories[record.id] ?? uuid();
    idMap.memories[record.id] = cloudId;
    const fingerprint = memoryFingerprint(record);
    if (syncedMemoryFingerprints.get(record.id) === fingerprint) continue;
    const memoryType = allowedTypes.has(record.kind) ? record.kind : 'semantic';
    pending.push({
      localId: record.id,
      fingerprint,
      row: {
        id: cloudId,
        owner_id: session.user.id,
        memory_type: memoryType,
        content: record.text.slice(0, 900),
        summary: record.text.slice(0, 240),
        importance: record.tier === 'hot' ? 5 : record.tier === 'warm' ? 3 : 1,
        confidence: record.confidence,
        source: record.source.slice(0, 120),
        local_embedding: record.vector,
        metadata: {
          local_memory_id: record.id,
          tier: record.tier,
          access_count: record.accessCount,
          accessed_at: record.accessedAt,
          fingerprint: record.fingerprint,
        },
        updated_at: new Date(record.updatedAt).toISOString(),
        archived_at: null,
      },
    });
  }
  writeIdMap(idMap);
  for (let offset = 0; offset < pending.length; offset += 100) {
    const batch = pending.slice(offset, offset + 100);
    const { error } = await cloudClient.from('ultron_memory_items').upsert(batch.map((item) => item.row), { onConflict: 'id' });
    if (error) throw error;
    for (const item of batch) syncedMemoryFingerprints.set(item.localId, item.fingerprint);
  }
}

export function rememberCloudMemories(records: CloudMemoryRecord[]): void {
  for (const record of records) syncedMemoryFingerprints.set(record.id, memoryFingerprint(record));
}

export function scheduleCloudMemorySync(records: CloudMemoryRecord[], onError?: (error: unknown) => void): void {
  if (memorySyncTimer) window.clearTimeout(memorySyncTimer);
  memorySyncTimer = window.setTimeout(() => {
    void syncCloudMemories(records).catch((error) => {
      console.warn('[ULTRON cloud memory sync]', error);
      onError?.(error);
    });
  }, 1600);
}

export async function pullCloudSetting(settingKey: string): Promise<unknown | null> {
  const session = await getCloudSession();
  if (!session) return null;
  const { data, error } = await cloudClient
    .from('ultron_settings')
    .select('setting_value')
    .eq('setting_key', settingKey)
    .maybeSingle();
  if (error) throw error;
  return data?.setting_value ?? null;
}

export function rememberCloudSetting(settingKey: string, settingValue: unknown): void {
  syncedSettingFingerprints.set(settingKey, stableFingerprint(settingValue));
}

export function scheduleCloudSetting(
  settingKey: string,
  settingValue: unknown,
  onError?: (error: unknown) => void,
): void {
  const fingerprint = stableFingerprint(settingValue);
  if (syncedSettingFingerprints.get(settingKey) === fingerprint) return;
  const previousTimer = settingsSyncTimers.get(settingKey);
  if (previousTimer) window.clearTimeout(previousTimer);
  const timer = window.setTimeout(() => {
    settingsSyncTimers.delete(settingKey);
    void (async () => {
      const session = await getCloudSession();
      if (!session) return;
      const { error } = await cloudClient.from('ultron_settings').upsert({
        owner_id: session.user.id,
        setting_key: settingKey,
        setting_value: settingValue,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'owner_id,setting_key' });
      if (error) throw error;
      syncedSettingFingerprints.set(settingKey, fingerprint);
    })().catch((error) => {
      console.warn('[ULTRON cloud settings sync]', error);
      onError?.(error);
    });
  }, 900);
  settingsSyncTimers.set(settingKey, timer);
}

export async function saveCloudModelProfile(modelId: string, displayName = modelId): Promise<void> {
  const session = await getCloudSession();
  if (!session || !modelId.trim()) return;
  const { error: clearError } = await cloudClient
    .from('ultron_model_profiles')
    .update({ is_default: false })
    .eq('owner_id', session.user.id);
  if (clearError) throw clearError;
  const { error } = await cloudClient.from('ultron_model_profiles').upsert({
    owner_id: session.user.id,
    provider: 'llama.cpp',
    model_id: modelId,
    display_name: displayName,
    runtime_kind: 'local',
    capabilities: ['chat', 'offline'],
    is_enabled: true,
    is_default: true,
    priority: 1,
    config: { device_local_weights: true, weights_synced: false },
  }, { onConflict: 'owner_id,provider,model_id' });
  if (error) throw error;
}

const DEVICE_KEY = 'ultron.cloud.device-key.v1';

export async function registerCloudDevice(): Promise<void> {
  const session = await getCloudSession();
  if (!session) return;
  let deviceKey = '';
  try {
    deviceKey = window.localStorage.getItem(DEVICE_KEY) ?? '';
    if (!deviceKey) {
      deviceKey = uuid();
      window.localStorage.setItem(DEVICE_KEY, deviceKey);
    }
  } catch {
    deviceKey = uuid();
  }
  const { error } = await cloudClient.from('ultron_device_sync').upsert({
    owner_id: session.user.id,
    device_key: deviceKey,
    device_name: (navigator.userAgent || 'ULTRON Android device').slice(0, 160),
    platform: 'capacitor-android',
    last_sync_at: new Date().toISOString(),
  }, { onConflict: 'owner_id,device_key' });
  if (error) throw error;
}
