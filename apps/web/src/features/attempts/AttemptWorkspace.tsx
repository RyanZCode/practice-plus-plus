import { tutorHintNames, type Attempt } from "@practice-plus-plus/contracts";
import type { ReactNode } from "react";
import { DailyProgress, PracticeType } from "../practice/Today";
import { formatRemainingSeconds } from "./attemptState";

export function AttemptWorkspace({
  attempt,
  seconds,
  busy,
  recording,
  completed,
  required,
  onPause,
  onSkip,
  onReport,
  onGiveUp,
  onCancel,
  onReview,
  onReturn,
  tutor,
  externalAi,
  children,
}: {
  attempt: Attempt;
  seconds: number;
  busy: boolean;
  recording: boolean;
  completed: number;
  required: number | null;
  onPause: () => void;
  onSkip: () => void;
  onReport: (incomplete: boolean) => void;
  onGiveUp: () => void;
  onCancel: () => void;
  onReview: () => void;
  onReturn: () => void;
  tutor: ReactNode;
  externalAi: ReactNode;
  children: ReactNode;
}) {
  const gaveUp = attempt.outcome === "GAVE_UP";
  const reporting = recording || (attempt.outcome !== null && !gaveUp);
  const phase = reporting ? "Result" : gaveUp ? "Solution review" : "Solve";

  return (
    <div className="attempt-workspace">
      <header className="attempt-header">
        <div>
          <p className="attempt-eyebrow">Active attempt · {attempt.practiceDate}</p>
          <h3>{attempt.problem.title}</h3>
          <div className="attempt-header-meta">
            <span className="attempt-metadata">
              #{attempt.problem.leetcodeId} ·{" "}
              {attempt.problem.difficulty.charAt(0) +
                attempt.problem.difficulty.slice(1).toLowerCase()}
              {attempt.problem.availability === "PAID_ONLY" ? " · Premium required" : ""}
            </span>
            <PracticeType redo={attempt.type === "REDO"} />
          </div>
        </div>
        <a
          className="attempt-problem-link"
          href={attempt.problem.url}
          target="_blank"
          rel="noreferrer"
        >
          Open on LeetCode ↗
        </a>
      </header>
      <ol className="attempt-steps" aria-label="Attempt phases">
        {["Solve", "Solution review", "Result"].map((step, index) => (
          <li key={step}>
            <span className="attempt-step" aria-current={phase === step ? "step" : undefined}>
              <span aria-hidden="true">{index + 1}</span>
              {step === "Solution review" ? "Solution review (if needed)" : step}
            </span>
          </li>
        ))}
      </ol>
      <div className="attempt-split">
        <aside className="attempt-sidebar" aria-label="Attempt status and actions">
          <section className="page-surface attempt-controls">
            {attempt.outcome === null ? (
              <>
                <p className="attempt-phase-label">
                  {seconds === 0 ? "Independent timer complete" : "Independent work"}
                </p>
                <p
                  className="countdown"
                  role="timer"
                  aria-label="Independent practice time remaining"
                >
                  {formatRemainingSeconds(seconds)}
                </p>
                <p className="settings-help">
                  {seconds === 0
                    ? "Keep solving, or ask for the smallest useful hint. There is no deadline."
                    : attempt.timerPausedAt
                      ? "Timer paused."
                      : "Work on LeetCode before seeking a hint."}
                </p>
                {seconds > 0 ? (
                  <div className="account-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy}
                      onClick={onPause}
                    >
                      {attempt.timerPausedAt ? "Resume timer" : "Pause timer"}
                    </button>
                    <button type="button" className="text-button" disabled={busy} onClick={onSkip}>
                      Skip timer
                    </button>
                  </div>
                ) : null}
                <p className="settings-help">
                  Skipping or expiry does not record help or end the attempt.
                </p>
              </>
            ) : (
              <>
                <p className="attempt-phase-label">{gaveUp ? "Gave up" : "Result reported"}</p>
                <p className="settings-help">Final confirmation is still required.</p>
              </>
            )}
            {attempt.outcome !== null &&
            attempt.outcome !== "INCOMPLETE" &&
            attempt.patterns?.length ? (
              <section className="revealed-patterns" aria-label="Revealed patterns">
                <p className="attempt-phase-label">Revealed patterns</p>
                <ul className="catalog-pattern-list">
                  {attempt.patterns.map((pattern) => (
                    <li key={pattern}>{pattern}</li>
                  ))}
                </ul>
              </section>
            ) : null}
            {gaveUp ? (
              <div className="attempt-review-actions">
                {attempt.solutionReviewedAt !== null ? (
                  <a
                    href={`https://leetcode.com/problems/${attempt.problem.slug}/solutions/`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Review LeetCode solutions ↗
                  </a>
                ) : (
                  <button type="button" disabled={busy} onClick={onReview}>
                    Review LeetCode solutions
                  </button>
                )}
                <p className="settings-help">
                  Close the reference and try coding from memory. Either result keeps the outcome
                  gave up.
                </p>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={reporting ? onReturn : () => onReport(false)}
                >
                  {reporting ? "Return to solution review" : "Review and confirm result"}
                </button>
              </div>
            ) : null}
            {attempt.outcome === null ? (
              <div className="attempt-result-actions">
                {!reporting ? (
                  <button type="button" disabled={busy} onClick={() => onReport(false)}>
                    Report result
                  </button>
                ) : null}
                {reporting ? (
                  <button type="button" className="text-button" disabled={busy} onClick={onReturn}>
                    Keep solving
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="attempt-secondary-actions">
              {attempt.outcome === null ? (
                <button type="button" className="text-button" disabled={busy} onClick={onGiveUp}>
                  Give up and review
                </button>
              ) : null}
              <button
                type="button"
                className="text-button danger-button"
                disabled={busy}
                onClick={onCancel}
              >
                Cancel attempt
              </button>
            </div>
          </section>
          <DailyProgress completed={completed} required={required} />
          {attempt.assistance.length > 0 ? (
            <section className="page-surface attempt-status">
              <h4>Recorded help</h4>
              <ul>
                {attempt.assistance.map((help, index) => (
                  <li key={index}>
                    {help.type.toLowerCase().replaceAll("_", " ")}
                    {help.hintLevel === null
                      ? ""
                      : ` (${tutorHintNames[help.hintLevel - 1] ?? `Guidance step ${help.hintLevel}`})`}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
        <div className="attempt-main">
          <div hidden={reporting}>{tutor}</div>
          <div hidden={!reporting}>{children}</div>
          {externalAi}
        </div>
      </div>
    </div>
  );
}
