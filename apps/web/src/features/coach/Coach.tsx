import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import {
  coachRequestSchema,
  type CoachRequest,
  type ConversationSummary,
  type DailyPlan,
  type MemorySuggestion,
  type ReasoningEffort,
} from "@practice-plus-plus/contracts";
import { useAuth } from "../auth/auth";
import { useModelDiscovery } from "../settings/ModelDiscovery";
import { AiRateLimitError, recentCoachMessages, streamCoach } from "./coachApi";
import { MarkdownMessage } from "../../shared/MarkdownMessage";
import { OpenAIModelSelect } from "../settings/OpenAIModelSelect";
import { ReasoningEffortSelect } from "../settings/ReasoningEffortSelect";
import {
  checkpointMessages,
  loadMemorySuggestions,
  saveCheckpoint,
} from "../learning-context/summaryApi";
import { openAiSelection } from "../../shared/aiSelection";
import { ExternalAiExport } from "../external-ai/ExternalAiExport";

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
  defaultReasoningEffort,
  onReviewMemory,
  onAiSetup,
  onPlanSaved,
  isActive,
}: {
  apiUrl: string;
  token: string;
  userId: string;
  defaultModel: string;
  defaultReasoningEffort: ReasoningEffort | null;
  onReviewMemory: () => void;
  onAiSetup: () => void;
  onPlanSaved: (plan: DailyPlan) => void;
  isActive: boolean;
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
  const [suggestionsError, setSuggestionsError] = useState<string>();
  const [suggestionsReload, setSuggestionsReload] = useState(0);
  const [externalOpen, setExternalOpen] = useState(false);
  const menus = useRef<HTMLDivElement>(null);
  const clearDialog = useRef<HTMLDialogElement>(null);
  const messageInput = useRef<HTMLTextAreaElement>(null);
  const canUseAi = keyState.hasKey && models.some((entry) => entry.id === model);
  const automaticCheckpointEnd = useRef(0);
  const checkpointIds = useRef(new Map<number, string>());
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
    if (!isActive) return;
    let active = true;
    setSuggestionsError(undefined);
    void loadMemorySuggestions(apiUrl, token)
      .then((items) => {
        if (active) setSuggestions(items);
      })
      .catch(() => {
        if (active)
          setSuggestionsError(
            "Unable to load memory suggestions. Your conversation is still available.",
          );
      });
    return () => {
      active = false;
    };
  }, [apiUrl, token, isActive, suggestionsReload]);

  useEffect(() => {
    const container = messagesRef.current;
    if (container !== null) container.scrollTop = container.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      menus.current?.querySelectorAll("details[open]").forEach((menu) => {
        if (event.target instanceof Node && !menu.contains(event.target))
          (menu as HTMLDetailsElement).open = false;
      });
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  async function checkpoint(source: Message[], endIndex: number): Promise<boolean> {
    const complete = source.filter((message) => message.complete);
    if (complete.length < 2 || checkpointBusy) return false;
    setCheckpointBusy(true);
    setCheckpointError(undefined);
    const checkpointId = checkpointIds.current.get(endIndex) ?? crypto.randomUUID();
    checkpointIds.current.set(endIndex, checkpointId);
    try {
      const result = await saveCheckpoint(apiUrl, token, {
        checkpointId,
        selection: openAiSelection(model, models, reasoningEffort),
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

  useEffect(() => {
    if (messages.length === 0) {
      automaticCheckpointEnd.current = 0;
      checkpointIds.current.clear();
    }
    const latest = messages.at(-1);
    if (
      busy ||
      checkpointBusy ||
      !canUseAi ||
      !latest?.complete ||
      latest.role !== "assistant" ||
      messages.length <= checkpointIndex ||
      automaticCheckpointEnd.current >= messages.length
    )
      return;
    automaticCheckpointEnd.current = messages.length;
    void checkpoint(messages.slice(checkpointIndex), messages.length);
  }, [messages, checkpointIndex, checkpointBusy, busy, canUseAi]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (active.current || !canUseAi) return;
    const user: Message = { role: "user", content: draft.trim(), complete: true };
    const contextMessages = messages.slice(checkpointIndex).filter((message) => message.complete);
    const input = coachRequestSchema.safeParse({
      selection: openAiSelection(model, models, reasoningEffort),
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
    } catch (error) {
      if (active.current === controller && error instanceof AiRateLimitError) {
        setMessages((current) => current.slice(0, -2));
        setDraft(user.content);
        setError(error.message);
        return;
      }
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
    <section className="coach coach-page">
      <div className="coach-heading">
        <div>
          <h2>Coach</h2>
          <p className="settings-help">Discuss your practice, progress, and next steps.</p>
        </div>
        <div
          className="coach-toolbar"
          ref={menus}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              const menu = (event.target as HTMLElement).closest("details");
              if (menu) {
                menu.open = false;
                menu.querySelector("summary")?.focus();
              }
            }
          }}
        >
          <button
            className="secondary-button"
            type="button"
            aria-expanded={externalOpen}
            aria-controls="coach-external"
            onClick={() => setExternalOpen((open) => !open)}
          >
            External AI
          </button>
          <details
            className="coach-menu"
            onToggle={(event) => {
              if (event.currentTarget.open)
                menus.current?.querySelectorAll("details").forEach((menu) => {
                  if (menu !== event.currentTarget) menu.open = false;
                });
            }}
          >
            <summary>Configure</summary>
            <div className="coach-menu-panel">
              <label>
                Conversation focus
                <select
                  value={purpose}
                  disabled={busy}
                  onChange={(event) => setPurpose(event.target.value as CoachRequest["purpose"])}
                >
                  <option value="GENERAL">General coaching</option>
                  <option value="PLANNING">Practice planning</option>
                </select>
              </label>
              <OpenAIModelSelect value={model} disabled={busy} onChange={setModel} />
              <ReasoningEffortSelect
                model={model}
                value={reasoningEffort}
                disabled={busy}
                onChange={setReasoningEffort}
              />
              <button type="button" className="text-button" onClick={onAiSetup}>
                Open AI settings
              </button>
            </div>
          </details>
          <details
            className="coach-menu"
            onToggle={(event) => {
              if (event.currentTarget.open)
                menus.current?.querySelectorAll("details").forEach((menu) => {
                  if (menu !== event.currentTarget) menu.open = false;
                });
            }}
          >
            <summary>Conversation</summary>
            <div className="coach-menu-panel">
              <p className="settings-help">
                Learning checkpoints and evidence-backed memories save automatically after replies.
              </p>
              <button
                type="button"
                className="secondary-button"
                disabled={busy || checkpointBusy || (messages.length === 0 && draft.length === 0)}
                onClick={() => clearDialog.current?.showModal()}
              >
                Clear conversation…
              </button>
              <p className="settings-help">
                Clears messages in this tab. Saved checkpoints and approved memories remain.
              </p>
            </div>
          </details>
        </div>
      </div>
      <dialog ref={clearDialog} className="attempt-dialog" aria-labelledby="coach-clear-heading">
        <h3 id="coach-clear-heading">Clear conversation?</h3>
        <p>
          This clears messages and the unsent draft in this tab. Saved checkpoints and approved
          memories remain.
        </p>
        <p className="settings-help">
          Completed replies are summarized automatically. Learning profile lets you inspect or
          remove saved learning.
        </p>
        <div className="account-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => clearDialog.current?.close()}
          >
            Keep conversation
          </button>
          <button
            type="button"
            className="danger-button"
            onClick={() => {
              setMessages([]);
              setCheckpointIndex(0);
              setError(undefined);
              setCheckpointError(undefined);
              setDraft("");
              clearDialog.current?.close();
              messageInput.current?.focus();
            }}
          >
            Clear conversation
          </button>
        </div>
      </dialog>
      {externalOpen ? (
        <div id="coach-external" className="page-surface">
          <ExternalAiExport
            key={purpose}
            heading="External AI"
            apiUrl={apiUrl}
            token={token}
            purpose={purpose}
            onPlanSaved={onPlanSaved}
          />
        </div>
      ) : null}
      {!keyState.hasKey ? (
        <div className="coach-unavailable" role="status">
          <p>Use your own AI chat, or add an OpenAI API key to chat here.</p>
          <button type="button" className="secondary-button" onClick={onAiSetup}>
            Set up AI
          </button>
        </div>
      ) : null}
      {keyState.hasKey && !canUseAi ? (
        <p role="status">Choose a discovered model in Configure before sending a message.</p>
      ) : null}
      <form className="coach-conversation page-surface" onSubmit={(event) => void send(event)}>
        <div className="coach-conversation-heading">
          <span>{purpose === "GENERAL" ? "General coaching" : "Practice planning"}</span>
          <span className="settings-help">Conversation stays in this tab</span>
        </div>
        {messages.length === 0 ? (
          <div className="coach-empty">
            <h3>What would you like to work through?</h3>
            <p className="settings-help">
              Review recent practice, reflect on a difficulty, or discuss your goals.
            </p>
          </div>
        ) : null}
        <ol
          ref={messagesRef}
          className="coach-messages"
          aria-label="Coach conversation"
          aria-live="polite"
          aria-busy={busy}
        >
          {messages.map((message, index) => (
            <li key={index} data-role={message.role}>
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
        <div className="coach-composer">
          <label>
            Message
            <textarea
              ref={messageInput}
              value={draft}
              maxLength={16000}
              rows={3}
              required
              disabled={busy || !canUseAi}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.ctrlKey && event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
          </label>
          <div className="coach-send-actions">
            <span className="settings-help">Ctrl+Enter to send</span>
            <div className="account-actions">
              <button
                className="primary-button"
                type="submit"
                title="Send (Ctrl+Enter)"
                aria-keyshortcuts="Control+Enter"
                disabled={busy || !canUseAi || draft.trim().length === 0}
              >
                {busy ? "Responding…" : "Send"}
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
            </div>
          </div>
          {error ? (
            <p className="auth-message" role="alert">
              {error}
            </p>
          ) : null}
          {checkpointError ? (
            <div className="auth-message" role="alert">
              {checkpointError}
              <button
                className="text-button"
                type="button"
                disabled={checkpointBusy}
                onClick={() => void checkpoint(messages.slice(checkpointIndex), messages.length)}
              >
                Retry automatic save
              </button>
            </div>
          ) : null}
          {checkpointBusy ? <p role="status">Saving learning automatically…</p> : null}
        </div>
      </form>
      {summary && !checkpointError && !checkpointBusy ? (
        <div className="coach-checkpoint page-surface" role="status">
          <strong>Learning checkpoint saved automatically</strong>
          <p>{summary.topics}</p>
        </div>
      ) : null}
      {suggestions.length > 0 ? (
        <section
          className="memory-review-queue coach-review-queue"
          aria-label="Memory review queue"
        >
          <div>
            <h3>
              {suggestions.length} learning {suggestions.length === 1 ? "memory" : "memories"}
            </h3>
            <p className="settings-help">
              Evidence-backed memories are approved automatically. You can inspect, correct, or
              delete them in Learning profile.
            </p>
          </div>
          <button
            className="secondary-button memory-review-button"
            type="button"
            onClick={onReviewMemory}
          >
            Manage in Learning profile
          </button>
        </section>
      ) : null}
      {suggestionsError ? (
        <div className="coach-unavailable">
          <p role="alert">{suggestionsError}</p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setSuggestionsReload((value) => value + 1)}
          >
            Retry suggestions
          </button>
        </div>
      ) : null}
      <p className="settings-help">
        Refreshing, closing the tab, or signing out clears messages. Saved checkpoints retain only a
        compact summary.
      </p>
    </section>
  );
}
