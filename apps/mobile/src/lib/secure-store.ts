/**
 * Secure storage wrapper for the mobile client.
 *
 * OAuth tokens and vault keys must never touch AsyncStorage in plaintext.
 * This module is the single place that talks to the platform keychain.
 */

export interface SecureStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * Placeholder in-memory implementation.
 *
 * TODO: replace with expo-secure-store, which is backed by the iOS Keychain
 * and Android Keystore. Never ship this in-memory version.
 */
export const secureStore: SecureStore = (() => {
  const mem = new Map<string, string>();
  return {
    async get(key) {
      return mem.get(key) ?? null;
    },
    async set(key, value) {
      mem.set(key, value);
    },
    async delete(key) {
      mem.delete(key);
    },
  };
})();
