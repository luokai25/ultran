import type { ConnectorManifest } from '../manifest.js';

export const openaiManifest: ConnectorManifest = {
  id: 'openai', version: '1.0.0', displayName: 'OpenAI',
  description: 'Use configured OpenAI models for text generation and embeddings.',
  capabilities: ['models:read', 'inference:run'],
  auth: { kind: 'pat', scopes: ['api-key'] },
  egress: [{ host: 'api.openai.com', port: 443 }],
  tools: [
    { id: 'openai.models.list', description: 'List models available to the configured API key.', capability: 'models:read', network: true, inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { id: 'openai.responses.create', description: 'Generate a response with an explicitly selected model.', capability: 'inference:run', network: true, inputSchema: { type: 'object', properties: { model: { type: 'string' }, input: { type: 'string', minLength: 1, maxLength: 100000 } }, required: ['model', 'input'], additionalProperties: false } },
  ],
};
