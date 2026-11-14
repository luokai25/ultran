import { addUltronCloudKey, type CloudProviderId } from "./cloud-llm";
import { DIRECT_PROVIDERS } from "./provider-adapters";

/**
 * Provider keys that ship inside this build (injected by CI from the ULTRON_BUNDLED_KEYS secret, never committed).
 * On launch each key is verified directly with its provider and saved into the normal on-device key list, where it
 * appears and rotates like any key the owner added by hand and is used by Automatic mode. A key is added once:
 * if the owner later removes it, it is not put back.
 */
export type BundledKey = { provider: CloudProviderId; key: string };
type SeedState = Record<string, "added" | "invalid">;

const STATE_KEY = "ultron.bundled-keys.v1";
const CONCURRENCY = 3;

export function parseBundledKeys(raw: unknown): BundledKey[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  let rows: unknown;
  try { rows = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  const keys: BundledKey[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const { p, k } = row as { p?: unknown; k?: unknown };
    if (typeof p !== "string" || typeof k !== "string" || !(p in DIRECT_PROVIDERS)) continue;
    const key = k.trim();
    if (key.length < 12 || key.length > 600 || /\s/.test(key) || seen.has(key)) continue;
    seen.add(key);
    keys.push({ provider: p as CloudProviderId, key });
  }
  return keys;
}

async function fingerprint(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readState(): SeedState {
  try { const parsed = JSON.parse(localStorage.getItem(STATE_KEY) ?? "{}") as SeedState; return parsed && typeof parsed === "object" ? parsed : {}; } catch { return {}; }
}
function writeState(state: SeedState): void { try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch { /* storage blocked; seeding simply repeats next launch */ } }

/** A provider that answered "this key is bad" is final; anything else (offline, rate limit, 5xx) is retried next launch. */
export function isFinalKeyFailure(message: string): boolean {
  return /\(HTTP (?:401|403)\)|does not look like|no compatible chat models/i.test(message);
}

export type SeedResult = { total: number; added: number; invalid: number; pending: number };

export async function seedBundledKeys(
  raw: unknown = import.meta.env.VITE_ULTRON_BUNDLED_KEYS,
  add: (provider: CloudProviderId, key: string, label: string) => Promise<unknown> = addUltronCloudKey,
): Promise<SeedResult> {
  const keys = parseBundledKeys(raw);
  const result: SeedResult = { total: keys.length, added: 0, invalid: 0, pending: 0 };
  if (!keys.length) return result;
  const state = readState();
  const counters = new Map<string, number>();
  const todo: Array<{ item: BundledKey; id: string; label: string }> = [];
  for (const item of keys) {
    const id = await fingerprint(item.key);
    const n = (counters.get(item.provider) ?? 0) + 1;
    counters.set(item.provider, n);
    if (state[id]) continue;
    todo.push({ item, id, label: `Built-in ${DIRECT_PROVIDERS[item.provider].label} ${n}` });
  }
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < todo.length) {
      const job = todo[next++]!;
      try {
        await add(job.item.provider, job.item.key, job.label);
        state[job.id] = "added"; result.added++;
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (isFinalKeyFailure(message)) { state[job.id] = "invalid"; result.invalid++; } else result.pending++;
      }
      writeState(state);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
  return result;
}
