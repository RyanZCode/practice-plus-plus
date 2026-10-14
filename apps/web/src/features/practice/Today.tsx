import type { Attempt, DailyPlan, PracticeSettings } from "@practice-plus-plus/contracts";
import { useState, type ReactNode } from "react";
import { formatRemainingSeconds } from "../attempts/attemptState";
import { RecentPracticePanel } from "./RecentPractice";
import { practiceDateLabel } from "./practiceHistory";

export function PracticeType({ redo }: { redo: boolean }) {
  return (
    <details className="practice-type">
      <summary>Practice type</summary>
      <p className="settings-help">
        {redo
          ? "Redo: you have attempted this problem before."
          : "Fresh: you have not attempted this problem before."}
      </p>
    </details>
  );
}

export function Today({
  apiUrl,
  token,
  plan,
  attempt,
  settings,
  busy,
  generatingPlan,
  aiReady,
  finishedForToday,
  seconds,
  refresh,
  onGenerate,
  onStart,
  onResume,
  onBrowse,
  onAiSetup,
  onExternalAi,
  onExtra,
  onStop,
  children,
}: {
  apiUrl: string;
  token: string;
  plan: DailyPlan | null;
  attempt: Attempt | null;
  settings: PracticeSettings;
  busy: boolean;
  generatingPlan: boolean;
  aiReady: boolean;
  finishedForToday: boolean;
  seconds: number;
  refresh: number;
  onGenerate: (personalized: boolean) => void;
  onStart: (problemId: string) => void;
  onResume: () => void;
  onBrowse: () => void;
  onAiSetup: () => void;
  onExternalAi: () => void;
  onExtra: () => void;
  onStop: () => void;
  children?: ReactNode;
}) {
  const [planningMethod, setPlanningMethod] = useState<"AI" | "WITHOUT_AI" | "EXTERNAL">("AI");
  const completed = plan?.items.filter((item) => item.status === "FINISHED").length ?? 0;
  const next = plan?.items.find((item) => item.status === "PENDING");
  const complete = plan !== null && plan.items.length > 0 && completed === plan.items.length;
  const problem = attempt?.problem ?? next?.problem;
  const resetTime = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(`2000-01-01T${settings.resetTime}:00Z`));

  return (
    <>
      <header className="today-heading">
        <div>
          <h2>Today</h2>
          {plan ? (
            <p className="settings-help">
              {practiceDateLabel(plan.practiceDate, {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </p>
          ) : null}
        </div>
        <p className="settings-help">
          Resets at {resetTime} · {settings.timeZone.replaceAll("_", " ")}
        </p>
      </header>
      <div className="today-layout">
        <div className="today-main">
          <section
            className="today-next daily-plan"
            aria-labelledby="today-next-heading"
            aria-busy={generatingPlan}
          >
            {generatingPlan ? (
              <>
                <div className="today-next-meta" aria-hidden="true">
                  <span className="today-status">Up next</span>
                  <span className="assignment-skeleton skeleton-difficulty" />
                </div>
                <h3 id="today-next-heading">
                  <span className="visually-hidden">Preparing your next problem</span>
                  <span className="assignment-skeleton skeleton-title" aria-hidden="true" />
                </h3>
                <p className="settings-help plan-loading-status" role="status">
                  <span className="plan-loading-spinner" aria-hidden="true" />
                  Generating your plan…
                </p>
                <div className="practice-type skeleton-practice-type" aria-hidden="true">
                  <span className="assignment-skeleton skeleton-type" />
                </div>
                <div className="account-actions" aria-hidden="true">
                  <span className="assignment-skeleton skeleton-start" />
                </div>
              </>
            ) : attempt !== null || (plan !== null && next !== undefined) ? (
              <>
                <div className="today-next-meta">
                  <span className="today-status">{attempt ? "Active attempt" : "Up next"}</span>
                  <span>
                    {problem!.difficulty.charAt(0) + problem!.difficulty.slice(1).toLowerCase()}
                  </span>
                  {problem!.availability === "PAID_ONLY" ? (
                    <span>LeetCode Premium required</span>
                  ) : null}
                </div>
                <h3 id="today-next-heading">
                  {problem!.leetcodeId}. {problem!.title}
                </h3>
                <p className="settings-help">
                  {attempt
                    ? attempt.timerPausedAt
                      ? `Timer paused · ${formatRemainingSeconds(seconds)} remaining`
                      : `${formatRemainingSeconds(seconds)} remaining`
                    : "Selected for your practice today."}
                </p>
                <PracticeType redo={attempt ? attempt.type === "REDO" : next!.kind === "REDO"} />
                <div className="account-actions">
                  <button
                    type="button"
                    disabled={busy || (attempt === null && problem!.availability === "UNAVAILABLE")}
                    onClick={attempt ? onResume : () => onStart(problem!.id)}
                  >
                    {attempt
                      ? "Resume attempt"
                      : problem!.availability === "UNAVAILABLE"
                        ? "Unavailable"
                        : "Start problem"}
                  </button>
                </div>
              </>
            ) : plan === null || plan.items.length === 0 ? (
              <>
                <p className="settings-help">
                  Daily target: {settings.dailyTarget}{" "}
                  {settings.dailyTarget === 1 ? "problem" : "problems"}
                </p>
                <h3 id="today-next-heading">Generate a plan</h3>
                <p className="settings-help">Choose how to build today's practice.</p>
                <div className="plan-creation-actions">
                  <div className="planning-methods" role="group" aria-label="Planning method">
                    {(
                      [
                        ["AI", "Practice++ AI"],
                        ["WITHOUT_AI", "Without AI"],
                        ["EXTERNAL", "My AI chat"],
                      ] as const
                    ).map(([method, label]) => (
                      <button
                        key={method}
                        type="button"
                        aria-pressed={planningMethod === method}
                        disabled={busy}
                        onClick={() => setPlanningMethod(method)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="settings-help planning-method-description">
                    {planningMethod === "EXTERNAL"
                      ? "Use your own AI chat, then review and save its recommendation."
                      : planningMethod === "AI"
                        ? aiReady
                          ? "AI recommendations based on your goals and learning history."
                          : "Connect your API key to generate plans with Practice++ AI."
                        : "New problems and due reviews selected from your practice history."}
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (planningMethod === "EXTERNAL") onExternalAi();
                      else if (planningMethod === "AI" && !aiReady) onAiSetup();
                      else onGenerate(planningMethod === "AI");
                    }}
                  >
                    {busy
                      ? "Creating plan…"
                      : planningMethod === "EXTERNAL"
                        ? "Prepare context"
                        : planningMethod === "AI" && !aiReady
                          ? "Set up AI"
                          : "Generate plan"}
                  </button>
                </div>
              </>
            ) : complete ? (
              <>
                <h3 id="today-next-heading">
                  {finishedForToday ? "Finished for today" : "Today's practice is complete"}
                </h3>
                <p className="settings-help">
                  Every assigned problem is recorded. You can stop here, or choose one extra
                  problem.
                </p>
                <div className="account-actions">
                  <button type="button" onClick={onStop} disabled={finishedForToday}>
                    Finish for today
                  </button>
                  <button type="button" className="secondary-button" onClick={onExtra}>
                    Extra practice
                  </button>
                </div>
                <p className="settings-help">
                  Extra practice does not change today's target or completion.
                </p>
              </>
            ) : (
              <>
                <h3 id="today-next-heading">Today's plan is closed</h3>
                <p className="settings-help">
                  An assignment was confirmed incomplete and does not count toward daily completion.
                  Other practice will not replace it in this saved plan.
                </p>
                <div className="account-actions">
                  <button type="button" onClick={onBrowse}>
                    Browse Problems
                  </button>
                </div>
              </>
            )}
          </section>
          {children}
          {generatingPlan || (plan !== null && plan.items.length > 0) ? (
            <section
              className="today-assignments page-surface"
              aria-labelledby="today-assignments-heading"
              aria-busy={generatingPlan}
            >
              <h3 id="today-assignments-heading">Today's assignments</h3>
              <ul className="today-assignment-list" aria-hidden={generatingPlan || undefined}>
                {generatingPlan
                  ? Array.from({ length: plan?.target ?? settings.dailyTarget }, (_, index) => (
                      <li key={index}>
                        <div className="assignment-skeleton-details">
                          <strong>
                            <span className="assignment-skeleton skeleton-title" />
                          </strong>
                          <p className="settings-help">
                            <span className="assignment-skeleton skeleton-difficulty" />
                          </p>
                          <div className="practice-type skeleton-practice-type">
                            <span className="assignment-skeleton skeleton-type" />
                          </div>
                        </div>
                        <span className="today-item-status assignment-skeleton skeleton-action" />
                      </li>
                    ))
                  : plan?.items.map((item) => (
                      <li key={item.id}>
                        <div>
                          <strong>
                            {item.problem.leetcodeId}. {item.problem.title}
                          </strong>
                          <p className="settings-help">
                            {item.problem.difficulty.charAt(0) +
                              item.problem.difficulty.slice(1).toLowerCase()}
                            {item.problem.availability === "PAID_ONLY"
                              ? " · LeetCode Premium required"
                              : ""}
                          </p>
                          <PracticeType redo={item.kind === "REDO"} />
                        </div>
                        {item.status === "FINISHED" || item.status === "INCOMPLETE" ? (
                          <span className={`today-item-status status-${item.status.toLowerCase()}`}>
                            {item.status === "FINISHED" ? "Completed" : "Incomplete"}
                          </span>
                        ) : item.status === "ACTIVE" ? (
                          <button
                            type="button"
                            className="text-button"
                            disabled={busy}
                            onClick={onResume}
                          >
                            Resume attempt
                          </button>
                        ) : item === next ? (
                          <span className="today-item-status">Not started</span>
                        ) : (
                          <button
                            type="button"
                            className="text-button"
                            disabled={
                              busy ||
                              attempt !== null ||
                              item.problem.availability === "UNAVAILABLE"
                            }
                            onClick={() => onStart(item.problem.id)}
                          >
                            {item.problem.availability === "UNAVAILABLE"
                              ? "Unavailable"
                              : "Start problem"}
                          </button>
                        )}
                      </li>
                    ))}
              </ul>
            </section>
          ) : null}
        </div>
        <aside className="today-sidebar" aria-label="Daily progress and recent practice">
          <section className="today-progress page-surface">
            <h3>Daily progress</h3>
            <p className="today-progress-value">
              {completed}
              <span> / {generatingPlan ? "-" : (plan?.items.length ?? "-")}</span>
            </p>
            {plan && plan.items.length > 0 ? (
              <progress value={completed} max={plan.items.length} aria-label="Daily completion" />
            ) : null}
            <p className="settings-help">
              {generatingPlan
                ? "Preparing your plan"
                : plan === null
                  ? "Create a plan to begin"
                  : plan.items.length === 0
                    ? "No practice available"
                    : "Completed from today's plan"}
            </p>
          </section>
          <RecentPracticePanel apiUrl={apiUrl} token={token} refresh={refresh} />
        </aside>
      </div>
    </>
  );
}
