import { registerPlugin } from "@capacitor/core";

type UltronSecureStoragePlugin = {
  get(options: { key: string }): Promise<{ value: string | null }>;
  set(options: { key: string; value: string }): Promise<{ stored: boolean }>;
  remove(options: { key: string }): Promise<{ removed: boolean }>;
};

export const nativeSecureStorage = registerPlugin<UltronSecureStoragePlugin>("UltronSecureStorage");
