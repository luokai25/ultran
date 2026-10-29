import type { ConnectorManifest } from '../manifest.js';
import { githubManifest } from './github.js';

/** Every first-party connector, ready to hand to ConnectorRegistry.load(). */
export const BUILTIN_CONNECTORS: ConnectorManifest[] = [githubManifest];
