import type { ConnectorManifest } from '../manifest.js';

export const telegramManifest: ConnectorManifest = {
  id: 'telegram', version: '1.0.0', displayName: 'Telegram',
  description: 'Send messages and inspect bot updates using a bot token.',
  capabilities: ['updates:read', 'messages:write'],
  auth: { kind: 'pat', scopes: ['bot-token'] },
  egress: [{ host: 'api.telegram.org', port: 443 }],
  tools: [
    { id: 'telegram.updates.get', description: 'Read pending bot updates.', capability: 'updates:read', network: true, inputSchema: { type: 'object', properties: { limit: { type: 'number', minimum: 1, maximum: 100 } }, additionalProperties: false } },
    { id: 'telegram.messages.send', description: 'Send a text message to an allowed chat.', capability: 'messages:write', network: true, inputSchema: { type: 'object', properties: { chatId: { type: 'string' }, text: { type: 'string', minLength: 1, maxLength: 4096 } }, required: ['chatId', 'text'], additionalProperties: false } },
  ],
};
