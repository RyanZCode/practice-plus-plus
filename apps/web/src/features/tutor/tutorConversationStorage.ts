export interface StoredTutorMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly complete: boolean;
  readonly label: string;
}

export interface StoredTutorConversation {
  readonly messages: StoredTutorMessage[];
  readonly checkpointIndex: number;
}

const keyPrefix = "practice-plus-plus:tutor-conversation:";
const maxMessages = 50;
const maxStoredCharacters = 1024 * 1024;

export function tutorConversationKey(userId: string, attemptId: string): string {
  return `${keyPrefix}${userId}:${attemptId}`;
}

export function loadTutorConversation(
  storage: Storage,
  userId: string,
  attemptId: string,
): StoredTutorConversation {
  try {
    const value: unknown = JSON.parse(
      storage.getItem(tutorConversationKey(userId, attemptId)) ?? "null",
    );
    if (!isConversation(value)) return { messages: [], checkpointIndex: 0 };
    return value;
  } catch {
    return { messages: [], checkpointIndex: 0 };
  }
}

export function saveTutorConversation(
  storage: Storage,
  userId: string,
  attemptId: string,
  conversation: StoredTutorConversation,
): void {
  const key = tutorConversationKey(userId, attemptId);
  if (conversation.messages.length === 0) {
    storage.removeItem(key);
    return;
  }

  let removed = Math.max(0, conversation.messages.length - maxMessages);
  let messages = conversation.messages.slice(removed);
  let checkpointIndex = Math.max(0, conversation.checkpointIndex - removed);
  let serialized = JSON.stringify({ messages, checkpointIndex });
  while (serialized.length > maxStoredCharacters && messages.length > 2) {
    messages = messages.slice(2);
    removed += 2;
    checkpointIndex = Math.max(0, conversation.checkpointIndex - removed);
    serialized = JSON.stringify({ messages, checkpointIndex });
  }

  try {
    if (serialized.length <= maxStoredCharacters) storage.setItem(key, serialized);
  } catch {
    // Browser storage may be unavailable or full. The in-memory conversation remains usable.
  }
}

export function clearTutorConversationsForUser(storage: Storage, userId: string): void {
  const prefix = `${keyPrefix}${userId}:`;
  try {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (key?.startsWith(prefix)) storage.removeItem(key);
    }
  } catch {
    // Treat unavailable browser storage as already cleared.
  }
}

function isConversation(value: unknown): value is StoredTutorConversation {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (
    !Array.isArray(candidate.messages) ||
    candidate.messages.length > maxMessages ||
    !Number.isInteger(candidate.checkpointIndex) ||
    (candidate.checkpointIndex as number) < 0 ||
    (candidate.checkpointIndex as number) > candidate.messages.length
  ) {
    return false;
  }
  return candidate.messages.every(
    (message) =>
      typeof message === "object" &&
      message !== null &&
      ((message as Record<string, unknown>).role === "user" ||
        (message as Record<string, unknown>).role === "assistant") &&
      typeof (message as Record<string, unknown>).content === "string" &&
      typeof (message as Record<string, unknown>).complete === "boolean" &&
      typeof (message as Record<string, unknown>).label === "string",
  );
}
