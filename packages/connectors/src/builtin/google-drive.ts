import type { ConnectorManifest } from '../manifest.js';

export const googleDriveManifest: ConnectorManifest = {
  id: 'google-drive', version: '1.0.0', displayName: 'Google Drive',
  description: 'Search, read metadata, and create files in explicitly authorized Drive scopes.',
  capabilities: ['drive:read', 'drive:write'],
  auth: { kind: 'oauth2', scopes: ['https://www.googleapis.com/auth/drive.metadata.readonly', 'https://www.googleapis.com/auth/drive.file'] },
  egress: [{ host: 'www.googleapis.com', port: 443 }],
  tools: [
    { id: 'google-drive.files.search', description: 'Search files visible to the authorized account.', capability: 'drive:read', network: true, inputSchema: { type: 'object', properties: { query: { type: 'string', maxLength: 500 }, pageSize: { type: 'number', minimum: 1, maximum: 100 } }, additionalProperties: false } },
    { id: 'google-drive.files.create', description: 'Create a file using the app-created file scope.', capability: 'drive:write', network: true, inputSchema: { type: 'object', properties: { name: { type: 'string', minLength: 1, maxLength: 255 }, mimeType: { type: 'string' }, content: { type: 'string', maxLength: 1000000 } }, required: ['name', 'content'], additionalProperties: false } },
  ],
};
