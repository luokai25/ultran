import type { ConnectorManifest } from '../manifest.js';

/**
 * Local files, scoped to a workspace directory.
 *
 * The proof that a connector needs no network: `egress` is empty and no tool is
 * marked `network`, so the sandbox can run it with all outbound traffic denied.
 * Writes are a separate capability from reads so a grant can be read-only.
 */
export const filesManifest: ConnectorManifest = {
  id: 'files',
  version: '1.0.0',
  displayName: 'Local files',
  description: 'Read, list and write files inside the workspace directory.',
  capabilities: ['fs:read', 'fs:write'],
  auth: { kind: 'none' },
  egress: [],
  tools: [
    {
      id: 'files.list',
      description: 'List the entries of a directory inside the workspace.',
      capability: 'fs:read',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
        additionalProperties: false,
      },
    },
    {
      id: 'files.read',
      description: 'Read a UTF-8 text file inside the workspace.',
      capability: 'fs:read',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          maxBytes: { type: 'number', minimum: 1, maximum: 1048576 },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
    {
      id: 'files.write',
      description: 'Create or overwrite a UTF-8 text file inside the workspace.',
      capability: 'fs:write',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
          createDirs: { type: 'boolean' },
        },
        required: ['path', 'content'],
        additionalProperties: false,
      },
    },
  ],
};
