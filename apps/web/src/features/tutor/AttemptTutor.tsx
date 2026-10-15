import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  tutorRequestSchema,
  tutorHintNames,
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
  onAiSetup,
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
  onAiSetup: () => void;
}) {
  const { browserKey } = useAuth();
  const { models } = useModelDiscovery();
  const keyState = useSyncExternalStore(browserKey.subscribe, browserKey.getSnapshot);
  const [model, setModel] = useState(defaultModel);
  const canUseAi = keyState.hasKey && models.some((entry) => entry.id === model);
  useEffect(() => setModel(defaultModel), [defaultModel]);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort | null>(
    defaultReasoningEffort,
  );
  useEffect(() => setReasoningEffort(defaultReasoningEffort), [defaultReasoningEffort]);
  const [draft, setDraft] = useState("");
  const messageInput = useRef<HTMLTextAreaElement>(null);
  const settingsMenu = useRef<HTMLDetailsElement>(null);
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
  const messagesRef = useRef<HTMLOListElement>(null);
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
  useEffect(() => {
    const container = messagesRef.current;
    if (container !== null) container.scrollTop = container.scrollHeight;
  }, [messages]);
  const highest = Math.min(
    tutorHintNames.length,
    Math.max(
      0,
      ...attempt.assistance
        .filter((event) => event.type === "CONCEPTUAL_HINT")
        .map((event) => event.hintLevel ?? 0),
    ),
  );
  const gaveUp = attempt.outcome === "GAVE_UP";
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !settingsMenu.current?.contains(event.target)) {
        if (settingsMenu.current) settingsMenu.current.open = false;
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
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
    if (active.current || disabled || checkpointBusy || !canUseAi) return;
    const label =
      requested.type === "CONCEPTUAL_HINT"
        ? tutorHintNames[requested.hintLevel - 1]!
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
      <div className="attempt-tutor-heading">
        <div>
          <h3>Attempt tutor</h3>
          <p className="settings-help">Help only when you ask.</p>
        </div>
        <details
          ref={settingsMenu}
          className="attempt-tutor-settings"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.currentTarget.open = false;
              event.currentTarget.querySelector("summary")?.focus();
            }
          }}
        >
          <summary>Tutor settings</summary>
          <div className="attempt-tutor-settings-panel">
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
            <button type="button" className="text-button" onClick={onAiSetup}>
              Open AI settings
            </button>
          </div>
        </details>
      </div>
      <p className="settings-help">
        Messages and code are sent to OpenAI and kept in this browser session. Help categories and
        requested hint levels are recorded.
      </p>
      {!keyState.hasKey ? (
        <div className="tutor-unavailable" role="status">
          <p>Add an API key to use the tutor. You can keep solving without AI.</p>
          <button type="button" className="secondary-button" onClick={onAiSetup}>
            Open AI settings
          </button>
        </div>
      ) : null}
      {keyState.hasKey && !canUseAi ? (
        <p role="status">Choose a discovered model in Tutor settings before requesting help.</p>
      ) : null}
      <div className="tutor-workspace">
        <div className="settings-form">
          {!gaveUp ? (
            <div className="tutor-help-actions" role="group" aria-label="Tutor help">
              {(
                [
                  ["CLARIFICATION", "Clarification"],
                  ["DEBUGGING", "Debugging"],
                  ["OPTIMIZATION", "Complexity and optimization"],
                ] as const
              ).map(([type, label]) => (
                <button
                  key={type}
                  type="button"
                  className="secondary-button"
                  aria-pressed={help.type === type}
                  disabled={busy || checkpointBusy || disabled || !canUseAi}
                  onClick={() => {
                    setHelp({ type });
                    messageInput.current?.focus();
                  }}
                >
                  {label}
                </button>
              ))}
              {highest > 0 ? (
                <button
                  type="button"
                  className="secondary-button"
                  aria-pressed={help.type === "CONCEPTUAL_HINT"}
                  disabled={busy || checkpointBusy || disabled || !canUseAi}
                  onClick={() => {
                    setHelp({ type: "CONCEPTUAL_HINT", hintLevel: highest });
                    messageInput.current?.focus();
                  }}
                >
                  Discuss {tutorHintNames[highest - 1]}
                </button>
              ) : null}
            </div>
          ) : null}
          {!gaveUp && hintsAvailable ? (
            <div className="tutor-hint-panel">
              <div>
                <strong>Progressive hints</strong>
                <p className="settings-help">
                  Current guidance: {highest === 0 ? "None" : tutorHintNames[highest - 1]}
                </p>
              </div>
              {highest < tutorHintNames.length ? (
                <div className="account-actions">
                  <button
                    type="button"
                    disabled={busy || disabled || !canUseAi}
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
                      disabled={busy || disabled || !canUseAi}
                      onClick={() =>
                        void send(
                          { type: "CONCEPTUAL_HINT", hintLevel: highest },
                          `Give me another ${tutorHintNames[highest - 1]!.toLowerCase()} without revealing more.`,
                        )
                      }
                    >
                      Ask for another {tutorHintNames[highest - 1]!.toLowerCase()}
                    </button>
                  ) : null}
                </div>
              ) : (
                <div>
                  <p>
                    Keep solving, discuss the outline, or give up before reviewing a full solution.
                  </p>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={busy || disabled || !canUseAi}
                    onClick={() =>
                      void send(
                        { type: "CONCEPTUAL_HINT", hintLevel: highest },
                        "Discuss the approach outline without revealing a full solution or complete code.",
                      )
                    }
                  >
                    Discuss the approach outline
                  </button>
                </div>
              )}
            </div>
          ) : null}
          <ol
            ref={messagesRef}
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
          {messages.length === 0 ? (
            <p className="settings-help">
              {gaveUp
                ? "Request a solution, then close the reference and try it from memory."
                : help.type === "DEBUGGING"
                  ? "Paste your code and describe what you expected to happen."
                  : help.type === "OPTIMIZATION"
                    ? "Describe your approach and the complexity you want to check."
                    : "Ask about the statement or a constraint without requesting a solution."}
            </p>
          ) : null}
          <label>
            {help.type === "DEBUGGING" ? "Code and question" : "Your question"}
            <textarea
              ref={messageInput}
              rows={3}
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
                busy || checkpointBusy || disabled || !canUseAi || draft.trim().length === 0
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
                  busy || checkpointBusy || disabled || !canUseAi || draft.trim().length > 0
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
                disabled={busy || checkpointBusy || disabled || !canUseAi}
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
      </div>
    </section>
  );
}
