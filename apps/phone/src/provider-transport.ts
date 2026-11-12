import { Capacitor, registerPlugin } from "@capacitor/core";
import { parseRetryAfterMs, type ProviderRequest, type ProviderResponse, type ProviderTransport } from "./provider-adapters";

type NativeProviderHttp = {
  request(options: ProviderRequest & { stream?: boolean; requestId?: string }): Promise<{ status: number; body: string; retryAfter: string }>;
  cancel(options: { requestId: string }): Promise<{ cancelled: boolean }>;
  addListener(eventName: "providerStreamChunk", listener: (event: { requestId: string; chunk: string }) => void): Promise<{ remove(): Promise<void> }>;
};

const abortError = (): DOMException => new DOMException("Generation stopped", "AbortError");

/** Development-browser transport. Subject to each provider's CORS policy, so it is not used on Android. */
export function createWebTransport(fetchImpl: typeof fetch = (...args) => fetch(...args)): ProviderTransport {
  const send = (req: ProviderRequest, signal?: AbortSignal): Promise<Response> =>
    fetchImpl(req.url, { method: req.method, headers: req.headers, body: req.body, cache: "no-store", signal });
  return {
    async request(req, signal): Promise<ProviderResponse> {
      const response = await send(req, signal);
      return { status: response.status, body: await response.text(), retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after")) };
    },
    async stream(req, onChunk, signal): Promise<ProviderResponse> {
      const response = await send(req, signal);
      const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
      if (!response.ok) return { status: response.status, body: (await response.text().catch(() => "")).slice(0, 4000), retryAfterMs };
      if (!response.body) throw new Error("The provider did not return a readable response stream.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          const text = decoder.decode(value, { stream: !done });
          if (text) onChunk(text);
          if (done) break;
        }
      } finally { await reader.cancel().catch(() => undefined); }
      return { status: response.status, body: "", retryAfterMs };
    },
  };
}

/** Android transport: native HTTPS through the UltronProviderHttp plugin, which has no CORS restrictions. */
export function createNativeTransport(plugin: NativeProviderHttp = registerPlugin<NativeProviderHttp>("UltronProviderHttp")): ProviderTransport {
  const toResponse = (result: { status: number; body: string; retryAfter: string }): ProviderResponse =>
    ({ status: result.status, body: result.body ?? "", retryAfterMs: parseRetryAfterMs(result.retryAfter) });
  return {
    async request(req, signal): Promise<ProviderResponse> {
      if (signal?.aborted) throw abortError();
      const requestId = crypto.randomUUID();
      const abort = (): void => { void plugin.cancel({ requestId }).catch(() => undefined); };
      signal?.addEventListener("abort", abort, { once: true });
      try { return toResponse(await plugin.request({ ...req, stream: false, requestId })); }
      catch (error) { if (signal?.aborted) throw abortError(); throw error; }
      finally { signal?.removeEventListener("abort", abort); }
    },
    async stream(req, onChunk, signal): Promise<ProviderResponse> {
      if (signal?.aborted) throw abortError();
      const requestId = crypto.randomUUID();
      const listener = await plugin.addListener("providerStreamChunk", (event) => { if (event.requestId === requestId && event.chunk) onChunk(event.chunk); });
      const abort = (): void => { void plugin.cancel({ requestId }).catch(() => undefined); };
      signal?.addEventListener("abort", abort, { once: true });
      try { return toResponse(await plugin.request({ ...req, stream: true, requestId })); }
      catch (error) { if (signal?.aborted) throw abortError(); throw error; }
      finally { signal?.removeEventListener("abort", abort); await listener.remove().catch(() => undefined); }
    },
  };
}

export function defaultProviderTransport(): ProviderTransport {
  return Capacitor.getPlatform() === "android" ? createNativeTransport() : createWebTransport();
}
