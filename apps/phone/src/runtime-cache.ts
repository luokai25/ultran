/**
 * Small, bounded, in-memory cache for non-sensitive runtime metadata.
 *
 * Conversation history, messages, attachments, provider secrets and task
 * checkpoints must never use this cache. They belong in durable storage.
 */
type CacheEntry<T> = { value: T; expiresAt: number; bytes: number; touchedAt: number };

export class RuntimeCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private bytes = 0;

  constructor(
    private readonly maxEntries = 64,
    private readonly maxBytes = 1_000_000,
  ) {}

  get(key: string, now = Date.now()): T | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
      this.delete(key);
      return null;
    }
    entry.touchedAt = now;
    // Refresh insertion order for LRU eviction.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, ttlMs: number, now = Date.now()): void {
    this.delete(key);
    if (!Number.isFinite(ttlMs) || ttlMs <= 0 || this.maxEntries <= 0 || this.maxBytes <= 0) return;
    let bytes: number;
    try {
      bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
    } catch {
      return;
    }
    if (!Number.isFinite(bytes) || bytes > this.maxBytes) return;
    this.entries.set(key, { value, expiresAt: now + ttlMs, bytes, touchedAt: now });
    this.bytes += bytes;
    this.evict();
  }

  delete(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.bytes -= entry.bytes;
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }

  get size(): number {
    return this.entries.size;
  }

  get sizeBytes(): number {
    return this.bytes;
  }

  private evict(): void {
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      this.delete(oldestKey);
    }
  }
}
