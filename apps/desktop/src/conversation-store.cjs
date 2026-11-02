const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

function createConversationStore({ getFilePath, validateMessages }) {
  if (typeof getFilePath !== 'function' || typeof validateMessages !== 'function') {
    throw new TypeError('Conversation store requires a path provider and message validator.');
  }
  let writeQueue = Promise.resolve();

  async function readCandidate(file) {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    // Version 1 is the durable envelope. Arrays are accepted for migration
    // from Ultran builds that stored a bare message list.
    const messages = Array.isArray(parsed) ? parsed : parsed?.version === 1 ? parsed.messages : null;
    if (!Array.isArray(messages)) throw new Error('Unsupported conversation history format.');
    return validateMessages(messages);
  }

  async function load() {
    const file = getFilePath();
    try {
      return { messages: await readCandidate(file), recovered: false, migrated: false };
    } catch (primaryError) {
      if (primaryError.code === 'ENOENT') {
        try {
          return { messages: await readCandidate(file + '.bak'), recovered: true, migrated: false };
        } catch (backupError) {
          if (backupError.code === 'ENOENT') return { messages: [], recovered: false, migrated: false };
          throw new Error('Conversation history and its backup are unreadable: ' + backupError.message);
        }
      }
      try {
        const messages = await readCandidate(file + '.bak');
        return { messages, recovered: true, migrated: false };
      } catch (backupError) {
        throw new Error('Conversation history is damaged and no valid backup is available: ' + backupError.message);
      }
    }
  }

  async function save(rawMessages) {
    const messages = validateMessages(rawMessages);
    const operation = writeQueue.then(async () => {
      const file = getFilePath();
      await fs.mkdir(path.dirname(file), { recursive: true });
      const suffix = crypto.randomUUID();
      const temporary = file + '.tmp.' + suffix;
      const backupTemporary = file + '.bak.tmp.' + suffix;
      try {
        const handle = await fs.open(temporary, 'wx');
        try {
          await handle.writeFile(JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), messages }), 'utf8');
          await handle.sync();
        } finally {
          await handle.close();
        }
        try {
          await fs.copyFile(file, backupTemporary);
          await fs.rename(backupTemporary, file + '.bak');
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        await fs.rename(temporary, file);
        return { saved: true, count: messages.length };
      } finally {
        await Promise.all([temporary, backupTemporary].map(item => fs.rm(item, { force: true }).catch(() => {})));
      }
    });
    writeQueue = operation.catch(() => {});
    return operation;
  }

  return Object.freeze({ load, save });
}

module.exports = { createConversationStore };
