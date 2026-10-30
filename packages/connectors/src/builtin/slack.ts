import type { ConnectorManifest } from '../manifest.js';

/**
 * Slack: post messages and read the channel list.
 *
 * One egress host. `chat:write` and `channel:read` are separate capabilities,
 * so an agent that may only look at channels can never be granted the ability
 * to speak in them.
 */
export const slackManifest: ConnectorManifest = {
  id: 'slack',
  version: '1.0.0',
  displayName: 'Slack',
  description: 'Post messages to channels and list the channels the bot can see.',
  capabilities: ['chat:write', 'channel:read'],
  auth: {
    kind: 'oauth2',
    scopes: ['chat:write', 'channels:read'],
  },
  egress: [{ host: 'slack.com', port: 443 }],
  tools: [
    {
      id: 'slack.channels.list',
      description: 'List public channels the bot is a member of or can join.',
      capability: 'channel:read',
      network: true,
      inputSchema: {
        type: 'object',
        properties: { limit: { type: 'number', minimum: 1, maximum: 200 } },
        additionalProperties: false,
      },
    },
    {
      id: 'slack.messages.post',
      description: 'Post a message to a channel.',
      capability: 'chat:write',
      network: true,
      inputSchema: {
        type: 'object',
        properties: {
          channel: { type: 'string' },
          text: { type: 'string', minLength: 1, maxLength: 4000 },
          threadTs: { type: 'string' },
        },
        required: ['channel', 'text'],
        additionalProperties: false,
      },
    },
  ],
};
