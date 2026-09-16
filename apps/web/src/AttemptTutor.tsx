import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  tutorRequestSchema,
  type Attempt,
  type MemorySuggestion,
  type TutorHelp,
} from "@practice-plus-plus/contracts";
import { useAuth } from "./auth";
import { recentCoachMessages, streamTutor } from "./coachApi";
import { MarkdownMessage } from "./MarkdownMessage";
import { OpenAIModelSelect } from "./OpenAIModelSelect";
import {
  checkpointMessages,
  loadMemorySuggestions,
  needsCheckpoint,
  saveCheckpoint,
} from "./summaryApi";
import {
  loadTutorConversation,
  saveTutorConversation,
  type StoredTutorMessage,
} from "./tutorConversationStorage";

const levels = ["Small nudge", "Key idea", "Approach outline"];
const actions = ["Get a small nudge", "Show me the key idea", "Outline the approach"];
type Message = StoredTutorMessage;

export function AttemptTutor({
  apiUrl,
  token,
  userId,
  defaultModel,
  attempt,
  hintsAvailable,
  disabled,
  onRefresh,
  onBusy,
}: {
  apiUrl: string;
  token: string;
  userId: string;
  defaultModel: string;
  attempt: Attempt;
  hintsAvailable: boolean;
  disabled: boolean;
  onRefresh: () => Promise<void>;
  onBusy: (busy: boolean) => void;
}) {
  const { browserKey } = useAuth();
  const keyState = useSyncExternalStore(browserKey.subscribe, browserKey.getSnapshot);
  const [model, setModel] = useState(defaultModel);
  useEffect(() => setModel(defaultModel), [defaultModel]);
  const [draft, setDraft] = useState("");
  const stored = useRef(loadTutorConversation(window.sessionStorage, userId, attempt.id));
  const [messages, setMessages] = useState<Message[]>(stored.current.messages);
  const [help, setHelp] = useState<TutorHelp>({ type: "CLARIFICATION" });
  const [busy, setBusy] = useState(false);
  const [checkpointBusy, setCheckpointBusy] = useState(false);
  const [checkpointIndex, setCheckpointIndex] = useState(stored.current.checkpointIndex);
  const [suggestions, setSuggestions] = useState<MemorySuggestion[]>([]);
  const [checkpointSaved, setCheckpointSaved] = useState(false);
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
    saveTutorConversation(window.sessionStorage, userId, attempt.id, {
      messages,
      checkpointIndex,
    });
  }, [attempt.id, checkpointIndex, messages, userId]);
  useEffect(() => {
    let active = true;
    void loadMemorySuggestions(apiUrl, token, attempt.id)
      .then((items) => {
        if (active) setSuggestions(items);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [apiUrl, token, attempt.id]);
  const highest = Math.min(
    3,
    Math.max(
      0,
      ...attempt.assistance
        .filter((event) => event.type === "CONCEPTUAL_HINT")
        .map((event) => event.hintLevel ?? 0),
    ),
  );
  const gaveUp = attempt.outcome === "GAVE_UP";

  async function checkpoint(source: Message[], endIndex: number): Promise<boolean> {
    const complete = source.filter((message) => message.complete);
    if (complete.length < 2 || checkpointBusy) return false;
    setCheckpointBusy(true);
    onBusy(true);
    setCheckpointError(undefined);
    try {
      const result = await saveCheckpoint(apiUrl, token, {
        selection: { providerId: "openai", model },
        apiKey: browserKey.getKey(userId) ?? "",
        mode: "ATTEMPT_TUTOR",
        attemptId: attempt.id,
        messages: recentCoachMessages(checkpointMessages(complete)),
      });
      setSuggestions((current) => [
        ...result.memorySuggestions,
        ...current.filter(
          (item) => !result.memorySuggestions.some((created) => created.id === item.id),
        ),
      ]);
      setCheckpointIndex(endIndex);
      setCheckpointSaved(true);
      await onRefresh();
      return true;
    } catch {
      setCheckpointError(
        "The checkpoint could not be saved. No messages or code were stored, and this conversation remains available in this tab.",
      );
      return false;
    } finally {
      setCheckpointBusy(false);
      onBusy(false);
    }
  }

  async function send(requested: TutorHelp, defaultMessage?: string) {
    if (active.current || disabled || checkpointBusy) return;
    const label =
      requested.type === "CONCEPTUAL_HINT"
        ? levels[requested.hintLevel - 1]!
        : requested.type === "SOLUTION_REVIEW"
          ? "Solution review"
          : requested.type === "OPTIMIZATION"
            ? "Complexity and optimization"
            : requested.type === "DEBUGGING"
              ? "Debugging"
              : "Clarification";
    const user: Message = {
      role: "user",
      content: draft.trim() || defaultMessage || "",
      complete: true,
      label,
    };
    let contextMessages = messages.slice(checkpointIndex).filter((message) => message.complete);
    if (needsCheckpoint([...contextMessages, user])) {
      const saved = await checkpoint(contextMessages, messages.length);
      if (saved) contextMessages = [];
    }
    const input = tutorRequestSchema.safeParse({
      selection: { providerId: "openai", model },
      apiKey: browserKey.getKey(userId),
      attemptId: attempt.id,
      help: requested,
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
    onBusy(true);
    setError(undefined);
    setDraft("");
    setHelp(requested);
    setMessages((current) => [
      ...current,
      user,
      { role: "assistant", content: "", complete: false, label },
    ]);
    try {
      await streamTutor(apiUrl, token, input.data, controller.signal, (text) => {
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
            ? "Response stopped. Received help remains recorded; partial replies are excluded from later context."
            : "The response could not be completed. Check your key and model, then try again. Partial replies are excluded from later context.",
        );
    } finally {
      if (active.current === controller) {
        await onRefresh();
        active.current = null;
        setBusy(false);
        onBusy(false);
      }
    }
  }

  return (
    <section className="coach">
      <h3>Attempt tutor</h3>
      <p className="settings-help">
        Messages and intentionally pasted code are sent to OpenAI. Practice++ keeps this
        conversation in this tab's browser session, so refreshing keeps it. Closing the tab, signing
        out, or clearing the conversation removes it. Only the help category and hint level are
        saved to the database.
      </p>
      {!keyState.hasKey ? (
        <p role="status">Add your OpenAI API key in Practice settings to use the tutor.</p>
      ) : null}
      <div className="settings-form">
        <OpenAIModelSelect
          value={model}
          disabled={busy || checkpointBusy || disabled}
          onChange={setModel}
        />
        {!gaveUp && hintsAvailable ? (
          <div>
            <p>Start with a small nudge, then request more help only if needed.</p>
            <p>Highest hint level: {highest === 0 ? "None" : levels[highest - 1]}</p>
            {highest < 3 ? (
              <div className="account-actions">
                <button
                  type="button"
                  disabled={busy || disabled || !keyState.hasKey}
                  onClick={() =>
                    void send({ type: "CONCEPTUAL_HINT", hintLevel: highest + 1 }, actions[highest])
                  }
                >
                  {actions[highest]}
                </button>
                {highest > 0 ? (
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={busy || disabled || !keyState.hasKey}
                    onClick={() =>
                      void send(
                        { type: "CONCEPTUAL_HINT", hintLevel: highest },
                        `Give me another ${levels[highest - 1]!.toLowerCase()} without revealing more.`,
                      )
                    }
                  >
                    Ask for another {levels[highest - 1]!.toLowerCase()}
                  </button>
                ) : null}
              </div>
            ) : (
              <div>
                <p>
                  Keep working independently, discuss the outline, or use the give-up action below.
                </p>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={busy || disabled || !keyState.hasKey}
                  onClick={() =>
                    void send(
                      { type: "CONCEPTUAL_HINT", hintLevel: highest },
                      "Give me another approach outline without revealing more.",
                    )
                  }
                >
                  Ask for another approach outline
                </button>
              </div>
            )}
          </div>
        ) : null}
        <ol
          className="coach-messages"
          aria-label="Tutor conversation"
          aria-live="polite"
          aria-busy={busy}
        >
          {messages.map((message, index) => (
            <li key={index}>
              <strong>{message.role === "user" ? "You" : `Tutor: ${message.label}`}</strong>
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
        {!gaveUp ? (
          <label>
            Help category
            <select
              value={help.type === "SOLUTION_REVIEW" ? "CLARIFICATION" : help.type}
              disabled={busy || disabled}
              onChange={(event) =>
                setHelp(
                  event.target.value === "CONCEPTUAL_HINT"
                    ? { type: "CONCEPTUAL_HINT", hintLevel: highest }
                    : {
                        type: event.target.value as "CLARIFICATION" | "DEBUGGING" | "OPTIMIZATION",
                      },
                )
              }
            >
              <option value="CLARIFICATION">Clarification</option>
              <option value="DEBUGGING">Debugging pasted code</option>
              <option value="OPTIMIZATION">Complexity analysis and optimization</option>
              {highest > 0 ? (
                <option value="CONCEPTUAL_HINT">Discuss {levels[highest - 1]}</option>
              ) : null}
            </select>
          </label>
        ) : null}
        <label>
          Message or code to send
          <textarea
            rows={4}
            maxLength={16000}
            value={draft}
            disabled={busy || disabled}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.ctrlKey && event.key === "Enter" && draft.trim().length > 0) {
                event.preventDefault();
                void send(gaveUp ? { type: "SOLUTION_REVIEW" } : help);
              }
            }}
          />
        </label>
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
        {checkpointSaved ? <p role="status">Learning checkpoint saved.</p> : null}
        {suggestions.length > 0 ? (
          <div>
            <strong>Pending memory suggestions</strong>
            <p className="settings-help">
              Review these during confirmation. They are not used as learner memory until approved.
            </p>
            <ul>
              {suggestions.map((suggestion) => (
                <li key={suggestion.id}>{suggestion.content}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="account-actions">
          <button
            className="primary-button"
            type="button"
            title="Send message (Ctrl+Enter)"
            aria-keyshortcuts="Control+Enter"
            disabled={
              busy || checkpointBusy || disabled || !keyState.hasKey || draft.trim().length === 0
            }
            onClick={() => void send(gaveUp ? { type: "SOLUTION_REVIEW" } : help)}
          >
            Send message
          </button>
          {gaveUp ? (
            <button
              type="button"
              className="secondary-button"
              disabled={
                busy || checkpointBusy || disabled || !keyState.hasKey || draft.trim().length > 0
              }
              onClick={() =>
                void send(
                  { type: "SOLUTION_REVIEW" },
                  "Explain the solution, then help me try coding from memory.",
                )
              }
            >
              Ask AI for the solution
            </button>
          ) : null}
          <button
            type="button"
            className="secondary-button"
            disabled={
              busy ||
              checkpointBusy ||
              disabled ||
              !keyState.hasKey ||
              messages.slice(checkpointIndex).filter((message) => message.complete).length < 2
            }
            onClick={() => void checkpoint(messages.slice(checkpointIndex), messages.length)}
          >
            {checkpointBusy ? "Saving checkpoint…" : "Save learning checkpoint"}
          </button>
          {busy ? (
            <button type="button" onClick={() => active.current?.abort()}>
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
              setDraft("");
              setError(undefined);
            }}
          >
            Clear conversation
          </button>
        </div>
        {gaveUp ? (
          <p>
            After reviewing, clear the conversation and close the reference. Try coding from memory,
            then optionally record whether you could reproduce it below.
          </p>
        ) : null}
      </div>
    </section>
  );
}
