import type { ConnectorManifest } from '../manifest.js';

export const anthropicManifest: ConnectorManifest = {
  id: 'anthropic', version: '1.0.0', displayName: 'Anthropic',
  description: 'Use configured Claude models through the Anthropic Messages API.',
  capabilities: ['models:read', 'inference:run'],
  auth: { kind: 'pat', scopes: ['api-key'] },
  egress: [{ host: 'api.anthropic.com', port: 443 }],
  tools: [
    { id: 'anthropic.models.list', description: 'List supported model identifiers from the local provider catalogue.', capability: 'models:read', network: false, inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { id: 'anthropic.messages.create', description: 'Generate a message with an explicitly selected model.', capability: 'inference:run', network: true, inputSchema: { type: 'object', properties: { model: { type: 'string' }, prompt: { type: 'string', minLength: 1, maxLength: 100000 }, maxTokens: { type: 'number', minimum: 1, maximum: 8192 } }, required: ['model', 'prompt'], additionalProperties: false } },
  ],
};
