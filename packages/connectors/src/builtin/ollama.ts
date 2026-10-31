import type { ConnectorManifest } from '../manifest.js';

export const ollamaManifest: ConnectorManifest = {
  id: 'ollama', version: '1.0.0', displayName: 'Ollama (local)',
  description: 'Discover and run models on a user-configured local Ollama host.',
  capabilities: ['models:read', 'inference:run'],
  auth: { kind: 'none' },
  egress: [{ host: 'localhost', port: 11434 }],
  tools: [
    { id: 'ollama.models.list', description: 'List models installed on the paired local Ollama runtime.', capability: 'models:read', network: true, inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { id: 'ollama.generate', description: 'Generate text using a locally installed model.', capability: 'inference:run', network: true, inputSchema: { type: 'object', properties: { model: { type: 'string' }, prompt: { type: 'string', minLength: 1, maxLength: 100000 }, stream: { type: 'boolean' } }, required: ['model', 'prompt'], additionalProperties: false } },
  ],
};
