export type CloudAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  text?: string;
};

export type CloudMessage = {
  id?: string;
  sequenceNo?: number;
  role: 'user' | 'assistant';
  content: string;
  attachments?: CloudAttachment[];
};

export type CloudConversation = {
  id: string;
  title: string;
  updatedAt: number;
  messages: CloudMessage[];
  deleted?: boolean;
};

export type LocalConversationForSync = CloudConversation & {
  sessionId?: string;
  executionLedger?: unknown;
  cognitiveCheckpoint?: unknown;
  knowledgeState?: unknown;
};

/**
 * Merge remote workspace state without discarding local-only work.
 * Stable message IDs are the identity boundary; sequence numbers define order.
 * A remote tombstone removes only the matching conversation.
 */
export function mergeCloudWorkspace(
  local: LocalConversationForSync[],
  remote: CloudConversation[],
): LocalConversationForSync[] {
  const merged = new Map(local.map((conversation) => [conversation.id, conversation]));
  for (const cloud of remote) {
    if (cloud.deleted) {
      merged.delete(cloud.id);
      continue;
    }
    const existing = merged.get(cloud.id);
    if (!existing) {
      merged.set(cloud.id, cloud);
      continue;
    }
    const remoteIsNewer = cloud.updatedAt > existing.updatedAt;
    const messages = [...existing.messages];
    const messageIndexes = new Map<string, number>();
    messages.forEach((message, index) => {
      messageIndexes.set(message.id ?? `local-index-${index}`, index);
    });
    cloud.messages.forEach((remoteMessage, index) => {
      const key = remoteMessage.id ?? `remote-index-${index}`;
      const existingIndex = messageIndexes.get(key);
      if (existingIndex === undefined) {
        messageIndexes.set(key, messages.length);
        messages.push(remoteMessage);
      } else if (remoteIsNewer) {
        messages[existingIndex] = remoteMessage;
      } else {
        messages[existingIndex] = {
          ...messages[existingIndex]!,
          sequenceNo: remoteMessage.sequenceNo,
        };
      }
    });
    messages.sort((left, right) =>
      (left.sequenceNo ?? Number.MAX_SAFE_INTEGER) - (right.sequenceNo ?? Number.MAX_SAFE_INTEGER),
    );
    merged.set(cloud.id, {
      ...existing,
      title: remoteIsNewer ? cloud.title : existing.title,
      updatedAt: Math.max(existing.updatedAt, cloud.updatedAt),
      messages,
    });
  }
  return [...merged.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}
