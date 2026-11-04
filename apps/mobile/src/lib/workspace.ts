import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type UltronConversation = {
  id: string;
  title: string;
  status: 'active' | 'archived' | 'deleted';
  last_message_at: string | null;
  updated_at: string;
};

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

export async function saveSetting(settingKey: string, settingValue: unknown) {
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
