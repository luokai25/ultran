import type { ConnectorManifest } from '../manifest.js';
import { filesManifest } from './files.js';
import { githubManifest } from './github.js';

export { filesManifest, githubManifest };

/** First-party connector catalogue. Manifests declare capabilities; runtime adapters execute them. */
export const BUILTIN_CONNECTORS: ConnectorManifest[] = [githubManifest, filesManifest];
