import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import {
  coachRequestSchema,
  type CoachRequest,
  type ConversationSummary,
  type MemorySuggestion,
} from "@practice-plus-plus/contracts";
import { useAuth } from "../auth/auth";
import { recentCoachMessages, streamCoach } from "./coachApi";
import { MarkdownMessage } from "../../shared/MarkdownMessage";
import { OpenAIModelSelect } from "../settings/OpenAIModelSelect";
import {
  checkpointMessages,
  loadMemorySuggestions,
  needsCheckpoint,
  saveCheckpoint,
} from "../learning-context/summaryApi";

interface Message {
  role: "user" | "assistant";
  content: string;
  complete: boolean;
}

export function Coach({
  apiUrl,
  token,
  userId,
  defaultModel,
  onReviewMemory,
}: {
  apiUrl: string;
  token: string;
  userId: string;
  defaultModel: string;
  onReviewMemory: () => void;
}) {
  const { browserKey } = useAuth();
  const keyState = useSyncExternalStore(browserKey.subscribe, browserKey.getSnapshot);
  const [model, setModel] = useState(defaultModel);
  useEffect(() => setModel(defaultModel), [defaultModel]);
  const [purpose, setPurpose] = useState<CoachRequest["purpose"]>("GENERAL");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [checkpointBusy, setCheckpointBusy] = useState(false);
  const [checkpointIndex, setCheckpointIndex] = useState(0);
  const [summary, setSummary] = useState<ConversationSummary | null>(null);
  const [suggestions, setSuggestions] = useState<MemorySuggestion[]>([]);
  const [checkpointError, setCheckpointError] = useState<string>();
  const [error, setError] = useState<string>();
  const active = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    [],
  );

  useEffect(() => {
    let active = true;
    void loadMemorySuggestions(apiUrl, token)
      .then((items) => {
        if (active) setSuggestions(items);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [apiUrl, token]);

  async function checkpoint(source: Message[], endIndex: number): Promise<boolean> {
    const complete = source.filter((message) => message.complete);
    if (complete.length < 2 || checkpointBusy) return false;
    setCheckpointBusy(true);
    setCheckpointError(undefined);
    try {
      const result = await saveCheckpoint(apiUrl, token, {
        selection: { providerId: "openai", model },
        apiKey: browserKey.getKey(userId) ?? "",
        mode: "COACH",
        attemptId: null,
        messages: recentCoachMessages(checkpointMessages(complete)),
      });
      setSummary(result.summary);
      setSuggestions((current) => [
        ...result.memorySuggestions,
        ...current.filter(
          (item) => !result.memorySuggestions.some((created) => created.id === item.id),
        ),
      ]);
      setCheckpointIndex(endIndex);
      return true;
    } catch {
      setCheckpointError(
        "The checkpoint could not be saved. No messages were stored, and this conversation remains available in this tab.",
      );
      return false;
    } finally {
      setCheckpointBusy(false);
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (active.current || checkpointBusy) return;
    const user: Message = { role: "user", content: draft.trim(), complete: true };
    let contextMessages = messages.slice(checkpointIndex).filter((message) => message.complete);
    if (needsCheckpoint([...contextMessages, user])) {
      const saved = await checkpoint(contextMessages, messages.length);
      if (saved) contextMessages = [];
    }
    const input = coachRequestSchema.safeParse({
      selection: { providerId: "openai", model },
      apiKey: browserKey.getKey(userId),
      purpose,
      messages: recentCoachMessages(
        [...contextMessages, user].map(({ role, content }) => ({
          role,
          content,
        })),
      ),
    });
    if (!input.success || input.data.messages.at(-1)?.content !== user.content) {
      setError(
        "Enter a message, a valid model name, and an API key in Practice settings. Shorten the message if it is too large.",
      );
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError(undefined);
    setDraft("");
    setMessages((current) => [
      ...current,
      user,
      { role: "assistant", content: "", complete: false },
    ]);
    try {
      await streamCoach(apiUrl, token, input.data, controller.signal, (text) => {
        if (active.current !== controller) return;
        setMessages((current) =>
          current.map((message, index) =>
            index === current.length - 1
              ? { ...message, content: message.content + text }
              : message,
          ),
        );
      });
      if (active.current === controller)
        setMessages((current) =>
          current.map((message, index) =>
            index === current.length - 1 ? { ...message, complete: true } : message,
          ),
        );
    } catch {
      if (active.current === controller)
        setError(
          controller.signal.aborted
            ? "Response stopped. Partial replies are not used in later context."
            : "The response could not be completed. Check your key and model, then try again. Partial replies are not used in later context.",
        );
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <section className="coach">
      <h2>Coach</h2>
      <p className="settings-help">
        Discuss your practice plan, progress, goals, or reflections. This conversation clears when
        you refresh, close the tab, or sign out. Learning checkpoints save a compact summary, never
        the transcript.
      </p>
      {!keyState.hasKey ? (
        <p role="status">Add your OpenAI API key in Practice settings to chat.</p>
      ) : null}
      <form className="settings-form" onSubmit={(event) => void send(event)}>
        <OpenAIModelSelect value={model} disabled={busy || checkpointBusy} onChange={setModel} />
        <label>
          Conversation focus
          <select
            value={purpose}
            disabled={busy || checkpointBusy}
            onChange={(event) => setPurpose(event.target.value as CoachRequest["purpose"])}
          >
            <option value="GENERAL">General coaching</option>
            <option value="PLANNING">Practice planning</option>
          </select>
        </label>
        <ol
          className="coach-messages"
          aria-label="Coach conversation"
          aria-live="polite"
          aria-busy={busy}
        >
          {messages.map((message, index) => (
            <li key={index}>
              <strong>{message.role === "user" ? "You" : "Coach"}</strong>
              {message.role === "assistant" ? (
                <MarkdownMessage>
                  {message.content || (busy ? "Thinking…" : "No response received.")}
                </MarkdownMessage>
              ) : (
                <p className="plain-message">{message.content}</p>
              )}
              {message.role === "assistant" && !message.complete && !busy ? (
                <small>Incomplete response</small>
              ) : null}
            </li>
          ))}
        </ol>
        <label>
          Message
          <textarea
            value={draft}
            maxLength={16000}
            rows={4}
            required
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.ctrlKey && event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
        </label>
        <div className="account-actions">
          <button
            className="primary-button"
            type="submit"
            title="Send (Ctrl+Enter)"
            aria-keyshortcuts="Control+Enter"
            disabled={busy || checkpointBusy || !keyState.hasKey}
          >
            {busy ? "Responding…" : "Send"}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={
              busy ||
              checkpointBusy ||
              !keyState.hasKey ||
              messages.slice(checkpointIndex).filter((message) => message.complete).length < 2
            }
            onClick={() => void checkpoint(messages.slice(checkpointIndex), messages.length)}
          >
            {checkpointBusy ? "Saving checkpoint…" : "Save learning checkpoint"}
          </button>
          {busy ? (
            <button
              type="button"
              className="secondary-button"
              onClick={() => active.current?.abort()}
            >
              Stop
            </button>
          ) : null}
          <button
            type="button"
            className="secondary-button"
            disabled={busy || checkpointBusy}
            onClick={() => {
              setMessages([]);
              setCheckpointIndex(0);
              setError(undefined);
              setDraft("");
            }}
          >
            Clear conversation
          </button>
        </div>
        {error ? (
          <p className="auth-message" role="alert">
            {error}
          </p>
        ) : null}
        {checkpointError ? (
          <p className="auth-message" role="alert">
            {checkpointError}
          </p>
        ) : null}
        {summary ? (
          <div role="status">
            <strong>Latest learning checkpoint</strong>
            <p>{summary.topics}</p>
          </div>
        ) : null}
        {suggestions.length > 0 ? (
          <section aria-label="Memory review queue">
            <h3>Memory suggestions to review</h3>
            <p className="settings-help">
              These inferences are pending and are not used in future coaching until you approve
              them.
            </p>
            <button
              className="secondary-button memory-review-button"
              type="button"
              onClick={onReviewMemory}
            >
              Review in Memory
            </button>
            <ul>
              {suggestions.map((suggestion) => (
                <li key={suggestion.id}>
                  <strong>{suggestion.category}</strong>: {suggestion.content}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </form>
    </section>
  );
}
