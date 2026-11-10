/**
 * ULTRON's durable local database.
 *
 * This adapter is intentionally independent of Supabase. It provides
 * transactional IndexedDB primitives for conversations, messages, attachments,
 * task checkpoints and metadata. Callers must await writes before reporting
 * that data has been saved.
 */

export type DurableBucket =
  | "conversations"
  | "messages"
  | "attachments"
  | "task-runs"
  | "task-events"
  | "checkpoints"
  | "settings"
  | "memory"
  | "metadata";

export type DurableRecord<T = unknown> = {
  id: string;
  bucket: DurableBucket;
  value: T;
  updatedAt: number;
};

export type StorageHealth = {
  supported: boolean;
  persistent: boolean | null;
  usageBytes: number | null;
  quotaBytes: number | null;
};

const DATABASE_NAME = "ultron-local";
const DATABASE_VERSION = 1;
const RECORDS_STORE = "records";
const META_STORE = "meta";
const MIGRATION_MARKER = "legacy-localstorage-v1";

let databasePromise: Promise<IDBDatabase> | null = null;

function storageError(error: unknown): Error {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "QuotaExceededError") {
    return new Error("ULTRON could not save this data because device storage is full. Free space or export data, then retry.");
  }
  if (name === "SecurityError" || name === "InvalidStateError") {
    return new Error("ULTRON's local database is unavailable in this browser context. Your data was not confirmed as saved.");
  }
  return error instanceof Error ? error : new Error("ULTRON could not complete a local database operation.");
}

export function openUltronDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is not available on this device."));
  }
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(RECORDS_STORE)) {
        const records = database.createObjectStore(RECORDS_STORE, { keyPath: "id" });
        records.createIndex("bucket", "bucket", { unique: false });
        records.createIndex("bucket_updated", ["bucket", "updatedAt"], { unique: false });
      }
      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };
      resolve(database);
    };
    request.onerror = () => reject(storageError(request.error));
    request.onblocked = () => reject(new Error("ULTRON's local database upgrade is blocked by another open app tab."));
  }).catch((error) => {
    databasePromise = null;
    throw storageError(error);
  });

  return databasePromise;
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(storageError(transaction.error));
    transaction.onerror = () => reject(storageError(transaction.error));
  });
}

export async function getDurableRecord<T>(bucket: DurableBucket, id: string): Promise<T | null> {
  const database = await openUltronDatabase();
  const transaction = database.transaction(RECORDS_STORE, "readonly");
  const done = transactionDone(transaction);
  const request = transaction.objectStore(RECORDS_STORE).get(id);
  const result = await new Promise<DurableRecord<T> | undefined>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as DurableRecord<T> | undefined);
    request.onerror = () => reject(storageError(request.error));
  });
  await done;
  return result?.bucket === bucket ? result.value : null;
}

export async function putDurableRecord<T>(bucket: DurableBucket, id: string, value: T): Promise<void> {
  const database = await openUltronDatabase();
  const transaction = database.transaction(RECORDS_STORE, "readwrite", { durability: "strict" });
  const done = transactionDone(transaction);
  transaction.objectStore(RECORDS_STORE).put({ id, bucket, value, updatedAt: Date.now() } satisfies DurableRecord<T>);
  await done.catch((error) => { throw storageError(error); });
}

export async function putDurableRecords<T>(records: Array<{ bucket: DurableBucket; id: string; value: T }>): Promise<void> {
  if (!records.length) return;
  const database = await openUltronDatabase();
  const transaction = database.transaction(RECORDS_STORE, "readwrite", { durability: "strict" });
  const done = transactionDone(transaction);
  const store = transaction.objectStore(RECORDS_STORE);
  const updatedAt = Date.now();
  for (const record of records) {
    store.put({ ...record, updatedAt } satisfies DurableRecord<T>);
  }
  await done.catch((error) => { throw storageError(error); });
}

export async function listDurableRecords<T>(bucket: DurableBucket): Promise<Array<{ id: string; value: T; updatedAt: number }>> {
  const database = await openUltronDatabase();
  const transaction = database.transaction(RECORDS_STORE, "readonly");
  const done = transactionDone(transaction);
  const request = transaction.objectStore(RECORDS_STORE).index("bucket").getAll(bucket);
  const records = await new Promise<DurableRecord<T>[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as DurableRecord<T>[]);
    request.onerror = () => reject(storageError(request.error));
  });
  await done;
  return records.map(({ id, value, updatedAt }) => ({ id, value, updatedAt }))
    .sort((a, b) => a.updatedAt - b.updatedAt);
}

export async function deleteDurableRecord(bucket: DurableBucket, id: string): Promise<void> {
  const database = await openUltronDatabase();
  const transaction = database.transaction(RECORDS_STORE, "readwrite", { durability: "strict" });
  const done = transactionDone(transaction);
  const store = transaction.objectStore(RECORDS_STORE);
  const request = store.get(id);
  request.onsuccess = () => {
    const record = request.result as DurableRecord | undefined;
    if (record?.bucket === bucket) store.delete(id);
  };
  await done.catch((error) => { throw storageError(error); });
}

/**
 * Copy legacy localStorage entries into IndexedDB in one transaction.
 * The source entries are deliberately retained until a later verified release;
 * migration must never delete the only surviving copy of a user's history.
 */
export async function migrateLegacyLocalStorage(keys: string[]): Promise<{ migrated: number; alreadyMigrated: boolean }> {
  if (typeof window === "undefined" || !window.localStorage) {
    throw new Error("Legacy browser storage is not available for migration.");
  }
  const database = await openUltronDatabase();
  const transaction = database.transaction([RECORDS_STORE, META_STORE], "readwrite", { durability: "strict" });
  const done = transactionDone(transaction);
  const meta = transaction.objectStore(META_STORE);
  const records = transaction.objectStore(RECORDS_STORE);
  const markerRequest = meta.get(MIGRATION_MARKER);
  const alreadyMigrated = await new Promise<boolean>((resolve, reject) => {
    markerRequest.onsuccess = () => resolve(Boolean(markerRequest.result));
    markerRequest.onerror = () => reject(storageError(markerRequest.error));
  });
  if (alreadyMigrated) {
    await done;
    return { migrated: 0, alreadyMigrated: true };
  }

  let migrated = 0;
  for (const key of keys) {
    const raw = window.localStorage.getItem(key);
    if (raw === null) continue;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      value = raw;
    }
    records.put({ id: `legacy:${key}`, bucket: "metadata", value, updatedAt: Date.now() } satisfies DurableRecord);
    migrated += 1;
  }
  meta.put({ key: MIGRATION_MARKER, completedAt: Date.now(), migrated });
  await done.catch((error) => { throw storageError(error); });
  return { migrated, alreadyMigrated: false };
}

export async function getStorageHealth(): Promise<StorageHealth> {
  if (typeof indexedDB === "undefined") {
    return { supported: false, persistent: null, usageBytes: null, quotaBytes: null };
  }
  let persistent: boolean | null = null;
  let usageBytes: number | null = null;
  let quotaBytes: number | null = null;
  try {
    if (navigator.storage?.persisted) persistent = await navigator.storage.persisted();
    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      usageBytes = typeof estimate.usage === "number" ? estimate.usage : null;
      quotaBytes = typeof estimate.quota === "number" ? estimate.quota : null;
    }
  } catch {
    // Health reporting is best-effort; durable reads and writes still report errors.
  }
  return { supported: true, persistent, usageBytes, quotaBytes };
}
