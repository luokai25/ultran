import type { ConnectorManifest } from '../manifest.js';
import { anthropicManifest } from './anthropic.js';
import { discordManifest } from './discord.js';
import { filesManifest } from './files.js';
import { githubManifest } from './github.js';
import { googleDriveManifest } from './google-drive.js';
import { notionManifest } from './notion.js';
import { ollamaManifest } from './ollama.js';
import { openaiManifest } from './openai.js';
import { slackManifest } from './slack.js';
import { telegramManifest } from './telegram.js';

export {
  anthropicManifest, discordManifest, filesManifest, githubManifest,
  googleDriveManifest, notionManifest, ollamaManifest, openaiManifest,
  slackManifest, telegramManifest,
};

/** First-party connector catalogue. Manifests declare capabilities; runtime adapters execute them. */
export const BUILTIN_CONNECTORS: ConnectorManifest[] = [
  githubManifest, slackManifest, filesManifest, notionManifest, discordManifest,
  telegramManifest, googleDriveManifest, openaiManifest, anthropicManifest, ollamaManifest,
];
