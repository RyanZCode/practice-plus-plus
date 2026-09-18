import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  tutorRequestSchema,
  type Attempt,
  type MemorySuggestion,
  type ReasoningEffort,
  type TutorHelp,
} from "@practice-plus-plus/contracts";
import { useAuth } from "../auth/auth";
import { useModelDiscovery } from "../settings/ModelDiscovery";
import { recentCoachMessages, streamTutor } from "../coach/coachApi";
import { MarkdownMessage } from "../../shared/MarkdownMessage";
import { OpenAIModelSelect } from "../settings/OpenAIModelSelect";
import { ReasoningEffortSelect } from "../settings/ReasoningEffortSelect";
import {
  checkpointMessages,
  loadMemorySuggestions,
  needsCheckpoint,
  saveCheckpoint,
} from "../learning-context/summaryApi";
import {
  loadTutorConversation,
  saveTutorConversation,
  type StoredTutorMessage,
} from "./tutorConversationStorage";
import { openAiSelection } from "../../shared/aiSelection";

const levels = ["Small nudge", "Key idea", "Approach outline"];
const actions = ["Get a small nudge", "Show me the key idea", "Outline the approach"];
type Message = StoredTutorMessage;

export function AttemptTutor({
  apiUrl,
  token,
  userId,
  defaultModel,
  defaultReasoningEffort,
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
  defaultReasoningEffort: ReasoningEffort | null;
  attempt: Attempt;
  hintsAvailable: boolean;
  disabled: boolean;
  onRefresh: () => Promise<void>;
  onBusy: (busy: boolean) => void;
}) {
  const { browserKey } = useAuth();
  const { models } = useModelDiscovery();
  const keyState = useSyncExternalStore(browserKey.subscribe, browserKey.getSnapshot);
  const [model, setModel] = useState(defaultModel);
  useEffect(() => setModel(defaultModel), [defaultModel]);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort | null>(
    defaultReasoningEffort,
  );
  useEffect(() => setReasoningEffort(defaultReasoningEffort), [defaultReasoningEffort]);
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
  const [workspaceOpen, setWorkspaceOpen] = useState(hintsAvailable || gaveUp);
  useEffect(() => {
    if (hintsAvailable || gaveUp) setWorkspaceOpen(true);
  }, [gaveUp, hintsAvailable]);
  const checkpointReady =
    messages.slice(checkpointIndex).filter((message) => message.complete).length >= 2;

  async function checkpoint(source: Message[], endIndex: number): Promise<boolean> {
    const complete = source.filter((message) => message.complete);
    if (complete.length < 2 || checkpointBusy) return false;
    setCheckpointBusy(true);
    onBusy(true);
    setCheckpointError(undefined);
    try {
      const result = await saveCheckpoint(apiUrl, token, {
        selection: openAiSelection(model, models, reasoningEffort),
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
      selection: openAiSelection(model, models, reasoningEffort),
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
    <section className="coach attempt-tutor">
      <p className="attempt-phase-label">AI support</p>
      <h3>Attempt tutor</h3>
      <p className="settings-help">
        Ask for clarification, debugging help, or progressive hints. Messages and pasted code are
        sent to OpenAI and kept in this browser session. Only the help category and hint level are
        saved.
      </p>
      {!keyState.hasKey ? (
        <p role="status">Add your OpenAI API key in Practice settings to use the tutor.</p>
      ) : null}
      <details
        className="tutor-workspace"
        open={workspaceOpen}
        onToggle={(event) => setWorkspaceOpen(event.currentTarget.open)}
      >
        <summary>
          {hintsAvailable || gaveUp ? "Tutor workspace" : "Ask for clarification or debugging help"}
        </summary>
        <div className="settings-form">
          <div className="ai-control-grid">
            <OpenAIModelSelect
              value={model}
              disabled={busy || checkpointBusy || disabled}
              onChange={setModel}
            />
            <ReasoningEffortSelect
              model={model}
              value={reasoningEffort}
              disabled={busy || checkpointBusy || disabled}
              onChange={setReasoningEffort}
            />
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
                            type: event.target.value as
                              "CLARIFICATION" | "DEBUGGING" | "OPTIMIZATION",
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
          </div>
          {!gaveUp && hintsAvailable ? (
            <div className="tutor-hint-panel">
              <div>
                <strong>Progressive hints</strong>
                <p className="settings-help">
                  Current level: {highest === 0 ? "None" : levels[highest - 1]}
                </p>
              </div>
              {highest < 3 ? (
                <div className="account-actions">
                  <button
                    type="button"
                    disabled={busy || disabled || !keyState.hasKey}
                    onClick={() =>
                      void send(
                        { type: "CONCEPTUAL_HINT", hintLevel: highest + 1 },
                        actions[highest],
                      )
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
                    Keep working independently, discuss the outline, or use the give-up action
                    below.
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
                Review these during confirmation. They are not used as learner memory until
                approved.
              </p>
              <ul className="memory-suggestion-list">
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
            {checkpointReady ? (
              <button
                type="button"
                className="secondary-button"
                disabled={busy || checkpointBusy || disabled || !keyState.hasKey}
                onClick={() => void checkpoint(messages.slice(checkpointIndex), messages.length)}
              >
                {checkpointBusy ? "Saving checkpoint…" : "Save learning checkpoint"}
              </button>
            ) : null}
            {busy ? (
              <button type="button" onClick={() => active.current?.abort()}>
                Stop
              </button>
            ) : null}
            {messages.length > 0 ? (
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
            ) : null}
          </div>
          {gaveUp ? (
            <p>
              After reviewing, clear the conversation and close the reference. Try coding from
              memory, then optionally record whether you could reproduce it below.
            </p>
          ) : null}
        </div>
      </details>
    </section>
  );
}
