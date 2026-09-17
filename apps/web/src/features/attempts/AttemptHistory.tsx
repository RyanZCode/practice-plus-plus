import type { AttemptHistoryQuery, AttemptHistoryResponse } from "@practice-plus-plus/contracts";
import { useEffect, useState } from "react";
import { loadAttemptHistory } from "./attemptsApi";
import { ReviewDateForm } from "./ReviewDateForm";

const labels: Record<string, string> = {
  INDEPENDENT: "Independent",
  ASSISTED: "Assisted",
  GAVE_UP: "Gave up",
  INCOMPLETE: "Incomplete",
  CONFIDENT: "Confident",
  SHAKY: "Shaky",
  OPTIMAL: "Optimal",
  SUBOPTIMAL: "Suboptimal",
  UNKNOWN: "Unknown",
  CLARIFICATION: "Clarification",
  CONCEPTUAL_HINT: "Conceptual hint",
  DEBUGGING: "Debugging",
  OPTIMIZATION: "Optimization",
  SOLUTION_REVIEW: "Editorial or solution review",
};

export function AttemptHistory({ apiUrl, token }: { apiUrl: string; token: string }) {
  const [pages, setPages] = useState<AttemptHistoryQuery[]>([{}]);
  const [page, setPage] = useState<AttemptHistoryResponse>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [reload, setReload] = useState(0);

  function scrollToHistory(): void {
    document.getElementById("attempt-history-heading")?.scrollIntoView({ block: "start" });
  }

  function showNewer(): void {
    setPages((value) => value.slice(0, -1));
    scrollToHistory();
  }

  function showOlder(): void {
    const next = page?.next;
    if (next === null || next === undefined) return;
    setPages((value) => [...value, next]);
    scrollToHistory();
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    setPage(undefined);
    void loadAttemptHistory(apiUrl, token, pages.at(-1) ?? {})
      .then((result) => {
        if (active) setPage(result);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Unable to load history.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [apiUrl, token, pages, reload]);

  return (
    <section className="attempt-history" aria-label="Attempt history">
      <h2 id="attempt-history-heading">Attempt history</h2>
      {loading ? <p role="status">Loading history…</p> : null}
      {error ? (
        <div>
          <p className="auth-message" role="alert">
            {error}
          </p>
          <button type="button" onClick={() => setReload((value) => value + 1)}>
            Try again
          </button>
        </div>
      ) : null}
      {page?.attempts.length === 0 ? <p>No confirmed attempts on this page.</p> : null}
      {page === undefined ? null : (
        <HistoryPagination
          disabled={loading}
          hasNewer={pages.length > 1}
          hasOlder={page.next !== null}
          pageNumber={pages.length}
          position="top"
          onNewer={showNewer}
          onOlder={showOlder}
        />
      )}
      <ol className="history-list">
        {page?.attempts.map((attempt) => (
          <li key={attempt.id}>
            <h3>
              <a href={attempt.problem.url} target="_blank" rel="noreferrer">
                {attempt.problem.leetcodeId}. {attempt.problem.title}
              </a>
            </h3>
            <p>
              {labels[attempt.outcome]} · {attempt.type === "FRESH" ? "Fresh" : "Redo"} · Practice
              date: {attempt.practiceDate}
            </p>
            {attempt.review !== null ? (
              <ReviewDateForm
                apiUrl={apiUrl}
                token={token}
                attemptId={attempt.id}
                review={attempt.review}
              />
            ) : null}
            {attempt.nextAction?.type === "COMPLETE" ? <p>Completed with no follow-up.</p> : null}
            {attempt.nextAction?.type === "TRANSFER" ? (
              <p>
                Fresh {attempt.nextAction.pattern} problem:{" "}
                {attempt.nextAction.dueDate
                  ? `eligible from ${attempt.nextAction.dueDate}`
                  : "eligible 7 calendar days after the practice date"}
                .
              </p>
            ) : null}
            <details>
              <summary>Attempt details</summary>
              <dl>
                <dt>Confirmed</dt>
                <dd>{new Date(attempt.confirmedAt).toLocaleString()}</dd>
                {attempt.confidence !== null ? (
                  <>
                    <dt>Confidence</dt>
                    <dd>{labels[attempt.confidence]}</dd>
                  </>
                ) : null}
                {attempt.optimality !== null ? (
                  <>
                    <dt>Solution quality</dt>
                    <dd>{labels[attempt.optimality]}</dd>
                  </>
                ) : null}
                {attempt.timeSpentSeconds !== null ? (
                  <>
                    <dt>Time spent</dt>
                    <dd>
                      {Math.floor(attempt.timeSpentSeconds / 60)}m {attempt.timeSpentSeconds % 60}s
                    </dd>
                  </>
                ) : null}
                {attempt.assistance.length > 0 ? (
                  <>
                    <dt>Assistance</dt>
                    <dd>
                      {attempt.assistance
                        .map(
                          (event) =>
                            `${labels[event.type]}${event.hintLevel === null ? "" : ` (level ${event.hintLevel})`}`,
                        )
                        .join(", ")}
                    </dd>
                  </>
                ) : null}
                {attempt.reproducedFromMemory !== null ? (
                  <>
                    <dt>Reproduced from memory</dt>
                    <dd>{attempt.reproducedFromMemory ? "Yes" : "No"}</dd>
                  </>
                ) : null}
                {attempt.approach ? (
                  <>
                    <dt>Approach</dt>
                    <dd>{attempt.approach}</dd>
                  </>
                ) : null}
                {attempt.notes ? (
                  <>
                    <dt>Notes</dt>
                    <dd>{attempt.notes}</dd>
                  </>
                ) : null}
              </dl>
            </details>
          </li>
        ))}
      </ol>
      {page === undefined ? null : (
        <HistoryPagination
          disabled={loading}
          hasNewer={pages.length > 1}
          hasOlder={page.next !== null}
          pageNumber={pages.length}
          position="bottom"
          onNewer={showNewer}
          onOlder={showOlder}
        />
      )}
    </section>
  );
}

function HistoryPagination({
  disabled,
  hasNewer,
  hasOlder,
  pageNumber,
  position,
  onNewer,
  onOlder,
}: {
  readonly disabled: boolean;
  readonly hasNewer: boolean;
  readonly hasOlder: boolean;
  readonly pageNumber: number;
  readonly position: "bottom" | "top";
  readonly onNewer: () => void;
  readonly onOlder: () => void;
}) {
  return (
    <nav
      id={position === "bottom" ? "attempt-history-end" : undefined}
      className={`history-pagination${position === "top" ? " history-pagination-sticky" : ""}`}
      aria-label="Attempt history pages"
    >
      <span>Page {pageNumber}</span>
      <div className="account-actions">
        <a href={position === "top" ? "#attempt-history-end" : "#attempt-history-heading"}>
          {position === "top" ? "Bottom" : "Back to top"}
        </a>
        {hasNewer ? (
          <button className="secondary-button" type="button" disabled={disabled} onClick={onNewer}>
            Newer attempts
          </button>
        ) : null}
        {hasOlder ? (
          <button className="secondary-button" type="button" disabled={disabled} onClick={onOlder}>
            Older attempts
          </button>
        ) : null}
      </div>
    </nav>
  );
}
