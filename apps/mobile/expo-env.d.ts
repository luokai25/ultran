/// <reference types="expo/types" />

// NOTE: This file should not be edited.
// See https://docs.expo.dev/guides/typescript/ for more information.

// Expo statically inlines these public environment variables at bundle time.
declare const process: {
  readonly env: {
    readonly EXPO_PUBLIC_SUPABASE_URL?: string;
    readonly EXPO_PUBLIC_SUPABASE_ANON_KEY?: string;
  };
};
