import type { ConnectorManifest } from '../manifest.js';

export const discordManifest: ConnectorManifest = {
  id: 'discord', version: '1.0.0', displayName: 'Discord',
  description: 'Read authorized guild channels and send messages.',
  capabilities: ['guild:read', 'messages:write'],
  auth: { kind: 'oauth2', scopes: ['identify', 'guilds', 'bot'] },
  egress: [{ host: 'discord.com', port: 443 }],
  tools: [
    { id: 'discord.guilds.list', description: 'List guilds available to the connection.', capability: 'guild:read', network: true, inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { id: 'discord.messages.send', description: 'Send a message to an explicitly authorized channel.', capability: 'messages:write', network: true, inputSchema: { type: 'object', properties: { channelId: { type: 'string' }, content: { type: 'string', minLength: 1, maxLength: 2000 } }, required: ['channelId', 'content'], additionalProperties: false } },
  ],
};
