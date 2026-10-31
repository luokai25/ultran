import type { ConnectorManifest } from '../manifest.js';

export const notionManifest: ConnectorManifest = {
  id: 'notion', version: '1.0.0', displayName: 'Notion',
  description: 'Search pages and create or update workspace content.',
  capabilities: ['pages:read', 'pages:write'],
  auth: { kind: 'oauth2', scopes: ['read_content', 'write_content'] },
  egress: [{ host: 'api.notion.com', port: 443 }],
  tools: [
    { id: 'notion.search', description: 'Search pages and databases.', capability: 'pages:read', network: true, inputSchema: { type: 'object', properties: { query: { type: 'string', maxLength: 200 }, pageSize: { type: 'number', minimum: 1, maximum: 100 } }, additionalProperties: false } },
    { id: 'notion.pages.create', description: 'Create a page under an authorized parent.', capability: 'pages:write', network: true, inputSchema: { type: 'object', properties: { parentId: { type: 'string' }, title: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['parentId', 'title'], additionalProperties: false } },
  ],
};
