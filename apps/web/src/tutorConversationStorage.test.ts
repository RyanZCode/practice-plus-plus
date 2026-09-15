import { describe, expect, it } from "vitest";
import {
  clearTutorConversationsForUser,
  loadTutorConversation,
  saveTutorConversation,
  tutorConversationKey,
} from "./tutorConversationStorage";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

const conversation = {
  checkpointIndex: 0,
  messages: [
    { role: "user" as const, content: "Get a small nudge", complete: true, label: "Small nudge" },
    {
      role: "assistant" as const,
      content: "Consider the total weight.",
      complete: true,
      label: "Small nudge",
    },
  ],
};

describe("tutor conversation storage", () => {
  it("restores a conversation for the same user and attempt", () => {
    const storage = memoryStorage();
    saveTutorConversation(storage, "user-1", "attempt-1", conversation);
    expect(loadTutorConversation(storage, "user-1", "attempt-1")).toEqual(conversation);
    expect(loadTutorConversation(storage, "user-1", "attempt-2").messages).toEqual([]);
  });

  it("rejects malformed stored values", () => {
    const storage = memoryStorage();
    storage.setItem(tutorConversationKey("user-1", "attempt-1"), JSON.stringify({ messages: [] }));
    expect(loadTutorConversation(storage, "user-1", "attempt-1")).toEqual({
      messages: [],
      checkpointIndex: 0,
    });
  });

  it("clears only the signed-out user's tutor conversations", () => {
    const storage = memoryStorage();
    saveTutorConversation(storage, "user-1", "attempt-1", conversation);
    saveTutorConversation(storage, "user-2", "attempt-2", conversation);
    clearTutorConversationsForUser(storage, "user-1");
    expect(loadTutorConversation(storage, "user-1", "attempt-1").messages).toEqual([]);
    expect(loadTutorConversation(storage, "user-2", "attempt-2")).toEqual(conversation);
  });
});
