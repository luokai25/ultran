import type { ConnectorManifest } from '../manifest.js';

/**
 * Reference connector: the smallest complete manifest.
 *
 * It exists to be copied. Every field is load-bearing: the two tools consume
 * exactly the two declared capabilities, and the egress list names the single
 * host the connector is ever permitted to reach.
 */
export const githubManifest: ConnectorManifest = {
  id: 'github',
  version: '1.0.0',
  displayName: 'GitHub',
  description: 'Read repositories and manage issues and pull requests.',
  capabilities: ['repo:read', 'issue:write'],
  auth: {
    kind: 'oauth2',
    scopes: ['repo', 'read:user'],
  },
  egress: [{ host: 'api.github.com', port: 443 }],
  tools: [
    {
      id: 'github.repos.list',
      description: 'List repositories the authenticated user can access.',
      capability: 'repo:read',
      network: true,
      inputSchema: {
        type: 'object',
        properties: {
          visibility: { type: 'string', enum: ['all', 'public', 'private'] },
          limit: { type: 'number', minimum: 1, maximum: 100 },
        },
        additionalProperties: false,
      },
    },
    {
      id: 'github.issues.create',
      description: 'Create an issue in a repository.',
      capability: 'issue:write',
      network: true,
      inputSchema: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          title: { type: 'string' },
          body: { type: 'string' },
          labels: { type: 'array', items: { type: 'string' } },
        },
        required: ['owner', 'repo', 'title'],
        additionalProperties: false,
      },
    },
  ],
};
