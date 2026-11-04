import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../src/lib/supabase';

export default function RootLayout() {
  useEffect(() => {
    if (Platform.OS === 'web') return;

    if (AppState.currentState === 'active') {
      supabase.auth.startAutoRefresh();
    }

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        supabase.auth.startAutoRefresh();
      } else {
        supabase.auth.stopAutoRefresh();
      }
    });

    return () => {
      subscription.remove();
      supabase.auth.stopAutoRefresh();
    };
  }, []);

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#080a0d' },
        }}
      >
        <Stack.Screen name="index" />
      </Stack>
    </>
  );
}
