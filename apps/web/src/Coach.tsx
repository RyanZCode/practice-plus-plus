import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { coachRequestSchema, type CoachRequest } from "@practice-plus-plus/contracts";
import { useAuth } from "./auth";
import { recentCoachMessages, streamCoach } from "./coachApi";

interface Message {
  role: "user" | "assistant";
  content: string;
  complete: boolean;
}

export function Coach({
  apiUrl,
  token,
  userId,
}: {
  apiUrl: string;
  token: string;
  userId: string;
}) {
  const { browserKey } = useAuth();
  const keyState = useSyncExternalStore(browserKey.subscribe, browserKey.getSnapshot);
  const [model, setModel] = useState("");
  const [purpose, setPurpose] = useState<CoachRequest["purpose"]>("GENERAL");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const active = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    [],
  );

  async function send(event: FormEvent) {
    event.preventDefault();
    if (active.current) return;
    const user: Message = { role: "user", content: draft.trim(), complete: true };
    const input = coachRequestSchema.safeParse({
      selection: { providerId: "openai", model },
      apiKey: browserKey.getKey(userId),
      purpose,
      messages: recentCoachMessages(
        [...messages.filter((message) => message.complete), user].map(({ role, content }) => ({
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
        you refresh, close the tab, or sign out. Advice does not change your saved plan or learning
        records.
      </p>
      {!keyState.hasKey ? (
        <p role="status">Add your OpenAI API key in Practice settings to chat.</p>
      ) : null}
      <form className="settings-form" onSubmit={(event) => void send(event)}>
        <label>
          OpenAI model
          <input
            value={model}
            maxLength={200}
            required
            disabled={busy}
            onChange={(event) => setModel(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="e.g. gpt-4.1-mini"
            aria-describedby="coach-model-help"
          />
        </label>
        <p className="settings-help" id="coach-model-help">
          Examples: <code>gpt-4.1-mini</code> or <code>gpt-4.1</code>. You can enter another model
          that supports streaming chat and is available to your API account.{" "}
          <a href="https://developers.openai.com/api/docs/models" target="_blank" rel="noreferrer">
            Browse OpenAI models
          </a>
          .
        </p>
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
        <ol
          className="coach-messages"
          aria-label="Coach conversation"
          aria-live="polite"
          aria-busy={busy}
        >
          {messages.map((message, index) => (
            <li key={index}>
              <strong>{message.role === "user" ? "You" : "Coach"}</strong>
              <p>{message.content || (busy ? "Thinking…" : "No response received.")}</p>
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
          />
        </label>
        {error ? (
          <p className="auth-message" role="alert">
            {error}
          </p>
        ) : null}
        <div className="account-actions">
          <button type="submit" disabled={busy || !keyState.hasKey}>
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
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => {
              setMessages([]);
              setError(undefined);
              setDraft("");
            }}
          >
            Clear conversation
          </button>
        </div>
      </form>
    </section>
  );
}
