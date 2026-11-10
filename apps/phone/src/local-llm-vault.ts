import { Capacitor } from "@capacitor/core";
import { nativeSecureStorage } from "./cloud-sync";

export type LocalProviderId = "openrouter" | "mistral" | "cerebras" | "groq" | "cohere" | "google_ai_studio";
export type LocalProviderKey = {
  id: string;
  provider: LocalProviderId;
  label: string;
  apiKey: string;
  status: string;
  enabled: boolean;
  priority: number;
  models: string[];
  created_at: string;
  last_checked_at: string | null;
  last_error: string | null;
};

const VAULT_KEY = "ultron.local.llm.vault.v1";
const DB_NAME = "ultron-local-crypto";
const STORE_NAME = "keys";
const CRYPTO_KEY_ID = "llm-vault-aes-gcm-v1";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function openCryptoDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the local encrypted key store."));
  });
}

async function getCryptoKey(): Promise<CryptoKey> {
  const db = await openCryptoDb();
  try {
    const existing = await new Promise<CryptoKey | undefined>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(CRYPTO_KEY_ID);
      request.onsuccess = () => resolve(request.result as CryptoKey | undefined);
      request.onerror = () => reject(request.error);
    });
    if (existing) return existing;
    const generated = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(generated, CRYPTO_KEY_ID);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error("Could not save the local vault key."));
    });
    return generated;
  } finally {
    db.close();
  }
}

async function readEncryptedVault(): Promise<LocalProviderKey[]> {
  if (Capacitor.getPlatform() === "android") {
    const result = await nativeSecureStorage.get({ key: VAULT_KEY });
    if (!result.value) return [];
    return JSON.parse(result.value) as LocalProviderKey[];
  }
  const stored = localStorage.getItem(VAULT_KEY);
  if (!stored) return [];
  if (!crypto.subtle || typeof indexedDB === "undefined") throw new Error("This browser cannot unlock the encrypted local API-key vault.");
  const envelope = JSON.parse(stored) as { iv: string; ciphertext: string };
  const key = await getCryptoKey();
  const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(envelope.iv) }, key, fromBase64(envelope.ciphertext));
  return JSON.parse(new TextDecoder().decode(clear)) as LocalProviderKey[];
}

async function writeEncryptedVault(keys: LocalProviderKey[]): Promise<void> {
  const serialized = JSON.stringify(keys);
  if (Capacitor.getPlatform() === "android") {
    const result = await nativeSecureStorage.set({ key: VAULT_KEY, value: serialized });
    if (!result.stored) throw new Error("Android secure storage did not confirm saving the API-key vault.");
    return;
  }
  if (!crypto.subtle || typeof indexedDB === "undefined") throw new Error("This browser cannot encrypt the local API-key vault.");
  const key = await getCryptoKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(serialized));
  localStorage.setItem(VAULT_KEY, JSON.stringify({ iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) }));
}

export async function listLocalProviderKeys(): Promise<Array<Omit<LocalProviderKey, "apiKey">>> {
  const keys = await readEncryptedVault();
  return keys.map(({ apiKey: _secret, ...metadata }) => metadata);
}

export async function getLocalProviderKeyCandidates(provider: LocalProviderId, modelId?: string): Promise<LocalProviderKey[]> {
  const keys = await readEncryptedVault();
  return keys.filter((key) => key.provider === provider && key.enabled && key.status === "connected" &&
    (!modelId || key.models.includes(modelId)))
    .sort((a, b) => b.priority - a.priority || a.created_at.localeCompare(b.created_at));
}

export async function getLocalProviderKey(provider: LocalProviderId, modelId?: string): Promise<LocalProviderKey | null> {
  return (await getLocalProviderKeyCandidates(provider, modelId))[0] ?? null;
}

export async function saveLocalProviderKey(input: Omit<LocalProviderKey, "id" | "created_at">): Promise<{ key: Omit<LocalProviderKey, "apiKey">; duplicate: boolean }> {
  const keys = await readEncryptedVault();
  const duplicate = keys.find((key) => key.provider === input.provider && key.apiKey === input.apiKey);
  if (duplicate) {
    const { apiKey: _secret, ...metadata } = duplicate;
    return { key: metadata, duplicate: true };
  }
  const saved: LocalProviderKey = { ...input, id: crypto.randomUUID(), created_at: new Date().toISOString() };
  await writeEncryptedVault([...keys, saved]);
  const { apiKey: _secret, ...metadata } = saved;
  return { key: metadata, duplicate: false };
}

export async function removeLocalProviderKey(provider: LocalProviderId, id: string): Promise<void> {
  const keys = await readEncryptedVault();
  await writeEncryptedVault(keys.filter((key) => key.provider !== provider || key.id !== id));
}

export async function updateLocalProviderKey(provider: LocalProviderId, id: string, patch: { enabled?: boolean; priority?: number }): Promise<void> {
  const keys = await readEncryptedVault();
  await writeEncryptedVault(keys.map((key) => key.provider !== provider || key.id !== id ? key : {
    ...key,
    ...(typeof patch.enabled === "boolean" ? { enabled: patch.enabled } : {}),
    ...(typeof patch.priority === "number" ? { priority: Math.max(1, Math.min(5, Math.trunc(patch.priority))) } : {}),
  }));
}
