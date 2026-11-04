import 'react-native-url-polyfill/auto';

import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import * as SecureStore from 'expo-secure-store';

const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://vshoxrtrfleptqxkrmtc.supabase.co';
const supabasePublishableKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  'sb_publishable_OuRYpP7YP76xv4mfUgd_ng_NF4nWVoV';

const secureStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient<Database>(supabaseUrl, supabasePublishableKey, {
  auth: {
    storage: secureStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
  realtime: {
    params: {
      eventsPerSecond: 5,
    },
  },
});
