import type { Session } from '@supabase/supabase-js';
import type { Json, Tables, TablesInsert } from './database.types';
import { supabase } from './supabase';

export type UltronConversation = {
  id: string;
  title: string;
  status: 'active' | 'archived' | 'deleted';
  last_message_at: string | null;
  updated_at: string;
};

export type UltronModelProfile = Tables<'ultron_model_profiles'>;

export type UltronMemory = {
  id: string;
  memory_type: string;
  content: string;
  summary: string | null;
  importance: number;
  confidence: number;
  created_at: string;
};

export async function verifyUltronOwner(session: Session) {
  const { data, error } = await supabase
    .from('ultron_instance')
    .select('display_name')
    .eq('owner_id', session.user.id)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new Error('This account is not registered as the owner of this ULTRON instance.');
  }

  return data;
}

export async function listConversations() {
  const { data, error } = await supabase
    .from('ultron_conversations')
    .select('id,title,status,last_message_at,updated_at')
    .neq('status', 'deleted')
    .order('updated_at', { ascending: false })
    .limit(30);

  if (error) throw error;
  return (data ?? []) as UltronConversation[];
}

export async function createConversation(title = 'New conversation') {
  const { data, error } = await supabase
    .from('ultron_conversations')
    .insert({ title })
    .select('id,title,status,last_message_at,updated_at')
    .single();

  if (error) throw error;
  return data as UltronConversation;
}

export async function getMemoryCount() {
  const { count, error } = await supabase
    .from('ultron_memory_items')
    .select('id', { count: 'exact', head: true })
    .is('archived_at', null);

  if (error) throw error;
  return count ?? 0;
}

export async function listMemories(limit = 50) {
  const { data, error } = await supabase
    .from('ultron_memory_items')
    .select('id,memory_type,content,summary,importance,confidence,created_at')
    .is('archived_at', null)
    .order('importance', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as UltronMemory[];
}

export async function saveSetting(settingKey: string, settingValue: Json) {
  const { error } = await supabase.from('ultron_settings').upsert(
    {
      setting_key: settingKey,
      setting_value: settingValue,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'owner_id,setting_key' },
  );

  if (error) throw error;
}

export async function registerDevice(deviceKey: string, deviceName: string, platform: string) {
  const { error } = await supabase.from('ultron_device_sync').upsert(
    {
      device_key: deviceKey,
      device_name: deviceName,
      platform,
      last_sync_at: new Date().toISOString(),
    },
    { onConflict: 'owner_id,device_key' },
  );

  if (error) throw error;
}

export type UltronMessage = {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  created_at: string;
  sequence_no: number;
  status: 'streaming' | 'complete' | 'failed' | 'cancelled';
};

export async function getConversation(conversationId: string) {
  const { data, error } = await supabase
    .from('ultron_conversations')
    .select('id,title,status,last_message_at,updated_at')
    .eq('id', conversationId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('This conversation does not exist or is not accessible.');
  return data as UltronConversation;
}

export async function listMessages(conversationId: string) {
  const { data, error } = await supabase
    .from('ultron_messages')
    .select('id,role,content,created_at,sequence_no,status')
    .eq('conversation_id', conversationId)
    .order('sequence_no', { ascending: true })
    .limit(500);

  if (error) throw error;
  return (data ?? []) as UltronMessage[];
}

export async function saveUserMessage(conversationId: string, content: string) {
  const trimmed = content.trim();
  if (!trimmed) throw new Error('Message cannot be empty.');

  const { data, error } = await supabase
    .from('ultron_messages')
    .insert({
      conversation_id: conversationId,
      role: 'user',
      content: trimmed,
      status: 'complete',
    })
    .select('id,role,content,created_at,sequence_no,status')
    .single();

  if (error) throw error;

  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from('ultron_conversations')
    .update({ last_message_at: now, updated_at: now })
    .eq('id', conversationId);

  if (updateError) throw updateError;
  return data as UltronMessage;
}

export async function createMemory(
  memory: Omit<TablesInsert<'ultron_memory_items'>, 'owner_id'>,
) {
  const { data, error } = await supabase
    .from('ultron_memory_items')
    .insert(memory)
    .select('id,memory_type,content,summary,importance,confidence,created_at')
    .single();

  if (error) throw error;
  return data as UltronMemory;
}

export async function saveModelProfile(
  profile: Omit<TablesInsert<'ultron_model_profiles'>, 'owner_id'>,
) {
  const { data, error } = await supabase
    .from('ultron_model_profiles')
    .upsert(profile, { onConflict: 'owner_id,provider,model_id' })
    .select('*')
    .single();

  if (error) throw error;
  return data as UltronModelProfile;
}

export async function listModelProfiles() {
  const { data, error } = await supabase
    .from('ultron_model_profiles')
    .select('*')
    .order('priority', { ascending: true })
    .order('display_name', { ascending: true });

  if (error) throw error;
  return (data ?? []) as UltronModelProfile[];
}

export async function listRecentTasks(limit = 30) {
  const { data, error } = await supabase
    .from('ultron_tasks')
    .select('id,title,description,task_type,status,priority,scheduled_at,started_at,completed_at,result,error_message,metadata,created_at,updated_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}
