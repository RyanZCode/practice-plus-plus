import {
  tutorHintNames,
  type AttemptHistoryQuery,
  type AttemptHistoryResponse,
} from "@practice-plus-plus/contracts";
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
  const [pageNumber, setPageNumber] = useState(1);
  const [page, setPage] = useState<AttemptHistoryResponse>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [reload, setReload] = useState(0);

  function scrollToHistory(): void {
    document.getElementById("attempt-history-heading")?.scrollIntoView({ block: "start" });
  }

  function showPage(nextPage: number): void {
    setPageNumber(nextPage);
    scrollToHistory();
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    setPage(undefined);
    void loadAttemptHistory(apiUrl, token, { page: pageNumber } satisfies AttemptHistoryQuery)
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
  }, [apiUrl, token, pageNumber, reload]);

  return (
    <section className="attempt-history page-surface" aria-label="Attempt history">
      <h2 id="attempt-history-heading">Attempt history</h2>
      {loading ? <p role="status">Loading history…</p> : null}
      {error ? (
        <div className="attempt-history-error">
          <p className="auth-message" role="alert">
            {error}
          </p>
          <button type="button" onClick={() => setReload((value) => value + 1)}>
            Try again
          </button>
        </div>
      ) : null}
      {page?.attempts.length === 0 ? <p>No confirmed attempts on this page.</p> : null}
      {page === undefined || page.totalPages === 0 ? null : (
        <HistoryPagination
          disabled={loading}
          currentPage={page.page}
          totalPages={page.totalPages}
          onPageChange={showPage}
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
                            `${labels[event.type]}${event.hintLevel === null ? "" : ` (${tutorHintNames[event.hintLevel - 1] ?? "Guidance step"})`}`,
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
    </section>
  );
}

export function HistoryPagination({
  disabled,
  currentPage,
  totalPages,
  onPageChange,
}: {
  readonly disabled: boolean;
  readonly currentPage: number;
  readonly totalPages: number;
  readonly onPageChange: (page: number) => void;
}) {
  return (
    <nav
      className="history-pagination history-pagination-sticky"
      aria-label="Attempt history pages"
    >
      <div className="history-page-links">
        {Array.from({ length: totalPages }, (_, index) => {
          const page = index + 1;
          return page === currentPage ? (
            <span
              key={page}
              className="history-page-current"
              aria-current="page"
              aria-label={`Page ${page}`}
            >
              {page}
            </span>
          ) : (
            <button
              key={page}
              className="secondary-button history-page-link"
              type="button"
              disabled={disabled}
              aria-label={`Page ${page}`}
              onClick={() => onPageChange(page)}
            >
              {page}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
