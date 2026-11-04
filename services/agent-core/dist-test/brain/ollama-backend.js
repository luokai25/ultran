function normalizedDigest(value) {
    return (value ?? '').trim().toLowerCase().replace(/^sha256:/, '');
}
export class OllamaBackend {
    kind = 'ollama';
    endpoint;
    timeoutMs;
    fetcher;
    constructor(options = {}) {
        this.endpoint = (options.endpoint ?? 'http://127.0.0.1:11434').replace(/\/+$/, '');
        this.timeoutMs = options.timeoutMs ?? 120_000;
        this.fetcher = options.fetcher ?? fetch;
        if (!/^https?:\/\//i.test(this.endpoint)) {
            throw new Error('Ollama endpoint must use http or https');
        }
    }
    async request(path, init) {
        let response;
        try {
            response = await this.fetcher(`${this.endpoint}${path}`, {
                ...init,
                signal: AbortSignal.timeout(this.timeoutMs),
                headers: { 'content-type': 'application/json', ...init?.headers },
            });
        }
        catch (error) {
            throw new Error(`Ollama is unreachable at ${this.endpoint}: ${String(error)}`);
        }
        if (!response.ok) {
            throw new Error(`Ollama ${path} returned HTTP ${response.status}`);
        }
        return response;
    }
    /** List locally installed models and their Ollama-reported content digests. */
    async listModels() {
        const response = await this.request('/api/tags');
        const payload = (await response.json());
        return (payload.models ?? [])
            .filter((model) => typeof model.digest === 'string' && !!(model.name || model.model))
            .map((model) => ({
            id: model.name ?? model.model ?? '',
            sha256: normalizedDigest(model.digest),
        }))
            .filter((model) => !!model.id && /^[a-f0-9]{64}$/.test(model.sha256));
    }
    async load(ref, _opts = {}) {
        if (!ref.sha256 || !/^[a-f0-9]{64}$/i.test(normalizedDigest(ref.sha256))) {
            throw new Error(`refusing to load "${ref.id}": a valid SHA-256 digest is required`);
        }
        const response = await this.request('/api/tags');
        const payload = (await response.json());
        const model = (payload.models ?? []).find((item) => item.name === ref.id || item.model === ref.id);
        if (!model)
            throw new Error(`model "${ref.id}" is not installed in Ollama`);
        if (normalizedDigest(model.digest) !== normalizedDigest(ref.sha256)) {
            throw new Error(`SHA-256 mismatch for model "${ref.id}"; refusing to load it`);
        }
        return { ref: { ...ref }, loadedAt: Date.now(), tokensIn: 0, tokensOut: 0 };
    }
    async *infer(handle, req) {
        const messages = [
            ...(req.system ? [{ role: 'system', content: req.system }] : []),
            { role: 'user', content: req.prompt },
        ];
        const response = await this.request('/api/chat', {
            method: 'POST',
            body: JSON.stringify({
                model: handle.ref.id,
                messages,
                stream: true,
                options: {
                    temperature: req.temperature ?? 0.2,
                    num_predict: req.maxTokens ?? 512,
                    num_ctx: handle.ref.contextWindow,
                },
                ...(req.stop?.length ? { stop: req.stop } : {}),
                ...(req.responseSchema ? { format: req.responseSchema } : {}),
            }),
        });
        if (!response.body)
            throw new Error('Ollama returned no inference stream');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let index = 0;
        try {
            while (true) {
                const { value, done } = await reader.read();
                buffer += decoder.decode(value, { stream: !done });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';
                for (const line of lines) {
                    if (!line.trim())
                        continue;
                    const item = JSON.parse(line);
                    const text = item.message?.content ?? '';
                    if (text)
                        yield { text, done: item.done === true, index: index++ };
                    if (item.done)
                        return;
                }
                if (done)
                    break;
            }
            if (buffer.trim()) {
                const item = JSON.parse(buffer);
                const text = item.message?.content ?? '';
                if (text)
                    yield { text, done: item.done === true, index: index++ };
            }
        }
        finally {
            await reader.cancel().catch(() => undefined);
        }
    }
    async embed(handle, texts) {
        const response = await this.request('/api/embed', {
            method: 'POST',
            body: JSON.stringify({ model: handle.ref.id, input: texts }),
        });
        const payload = (await response.json());
        if (!Array.isArray(payload.embeddings) || payload.embeddings.length !== texts.length) {
            throw new Error('Ollama returned an invalid embeddings payload');
        }
        return payload.embeddings.map((embedding) => Float32Array.from(embedding));
    }
    async unload(_handle) {
        // Ollama manages its own model residency; unloading is intentionally a no-op.
    }
}
//# sourceMappingURL=ollama-backend.js.map