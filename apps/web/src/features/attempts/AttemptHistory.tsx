import {
  tutorHintNames,
  type AttemptHistoryQuery,
  type AttemptHistoryResponse,
} from "@practice-plus-plus/contracts";
import { useEffect, useState } from "react";
import { loadAttemptHistory } from "./attemptsApi";
import { ReviewDateForm } from "./ReviewDateForm";
import { LoadingStatus } from "../../shared/LoadingStatus";
import { DetailDialog } from "../../shared/DetailDialog";

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

export function AttemptHistory({
  apiUrl,
  token,
  isActive = true,
  problem,
  onClearProblem,
}: {
  apiUrl: string;
  token: string;
  isActive?: boolean;
  problem: { id: string; title: string } | null;
  onClearProblem: () => void;
}) {
  const [pageNumber, setPageNumber] = useState(1);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<AttemptHistoryResponse>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search.trim());
      setPageNumber(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  function scrollToHistory(): void {
    document.getElementById("attempt-history-heading")?.scrollIntoView({ block: "start" });
  }

  function showPage(nextPage: number): void {
    setPageNumber(nextPage);
    scrollToHistory();
  }

  useEffect(() => {
    if (!isActive) return;
    let active = true;
    setLoading(true);
    setError(undefined);
    setPage(undefined);
    void loadAttemptHistory(apiUrl, token, {
      page: pageNumber,
      ...(query === "" ? {} : { query }),
      ...(problem === null ? {} : { problemId: problem.id }),
    } satisfies AttemptHistoryQuery)
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
  }, [apiUrl, token, pageNumber, reload, isActive, problem, query]);

  return (
    <section className="attempt-history" aria-labelledby="attempt-history-heading">
      <header className="history-heading">
        <h2 id="attempt-history-heading">History</h2>
        <p>{problem === null ? "Confirmed attempts" : `Confirmed attempts for ${problem.title}`}</p>
        {problem !== null ? (
          <button type="button" className="secondary-button" onClick={onClearProblem}>
            Show all history
          </button>
        ) : null}
      </header>
      <div className="history-search">
        <div className="search-field history-search-field">
          <label>
            <span className="visually-hidden">Search history</span>
            <input
              type="search"
              value={search}
              maxLength={200}
              placeholder="Search history by title or number"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          {search !== "" ? (
            <button
              type="button"
              className="search-clear-button"
              aria-label="Clear search"
              onClick={() => setSearch("")}
            >
              ×
            </button>
          ) : null}
        </div>
      </div>
      <div className="history-surface page-surface" aria-busy={loading}>
        {loading ? <LoadingStatus>Loading history…</LoadingStatus> : null}
        {error ? (
          <div className="attempt-history-error">
            <p className="auth-message" role="alert">
              {error}
            </p>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setReload((value) => value + 1)}
            >
              Try again
            </button>
          </div>
        ) : null}
        {page?.attempts.length === 0 ? (
          <div className="history-empty">
            <h3>
              {query !== ""
                ? "No matching attempts"
                : problem === null
                  ? "No confirmed attempts yet"
                  : "No confirmed attempts for this problem"}
            </h3>
            <p>
              {query === ""
                ? "Attempts appear here after confirmation."
                : "Try a different problem title or LeetCode number."}
            </p>
          </div>
        ) : null}
        {page && page.attempts.length > 0 ? (
          <>
            <div className="history-page-summary">
              <span>
                Page {page.page} of {page.totalPages}
              </span>
              <span>Practice dates</span>
            </div>
            <div className="history-column-headings" aria-hidden="true">
              <span>Problem</span>
              <span>Date</span>
              <span>Outcome</span>
              <span>Follow-up</span>
            </div>
            <ol className="history-list">
              {page.attempts.map((attempt) => (
                <HistoryRow key={attempt.id} attempt={attempt} apiUrl={apiUrl} token={token} />
              ))}
            </ol>
            {page.totalPages > 1 ? (
              <HistoryPagination
                disabled={loading}
                currentPage={page.page}
                totalPages={page.totalPages}
                onPageChange={showPage}
              />
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}

function HistoryRow({
  attempt,
  apiUrl,
  token,
}: {
  attempt: AttemptHistoryResponse["attempts"][number];
  apiUrl: string;
  token: string;
}) {
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState(attempt.review);
  const typeLabel = attempt.type === "FRESH" ? "Fresh" : "Redo";
  const reviewDate = review?.manualDueDate ?? review?.generatedDueDate;
  return (
    <li>
      <button
        type="button"
        className="history-row"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <span className="history-problem">
          <strong>
            {attempt.problem.leetcodeId}. {attempt.problem.title}
          </strong>
          <small>{typeLabel}</small>
        </span>
        <span className="history-date">
          <time dateTime={attempt.practiceDate}>{formatPracticeDate(attempt.practiceDate)}</time>
          <small className="history-mobile-type"> · {typeLabel}</small>
        </span>
        <span className="history-outcome">{labels[attempt.outcome]}</span>
        <span className="history-follow-up">
          {reviewDate ? (
            <>
              {attempt.outcome === "INCOMPLETE" ? "Retry" : "Redo"} {formatPracticeDate(reviewDate)}
              {review?.manualDueDate ? <small>Manual override</small> : null}
            </>
          ) : attempt.nextAction?.type === "TRANSFER" ? (
            <>
              Transfer
              {attempt.nextAction.dueDate
                ? ` ${formatPracticeDate(attempt.nextAction.dueDate)}`
                : " after 7 days"}
            </>
          ) : attempt.nextAction?.type === "COMPLETE" ? (
            "Complete"
          ) : (
            "No follow-up"
          )}
        </span>
        <span className="row-chevron" aria-hidden="true">
          ›
        </span>
      </button>
      <DetailDialog
        open={open}
        onClose={() => setOpen(false)}
        title={`${attempt.problem.leetcodeId}. ${attempt.problem.title}`}
        subtitle={`${formatPracticeDate(attempt.practiceDate)} · ${typeLabel} · ${labels[attempt.outcome]}`}
      >
        <div className="history-attempt-details">
          <a href={attempt.problem.url} target="_blank" rel="noreferrer">
            Open on LeetCode ↗
          </a>
          <dl className="history-facts">
            <div>
              <dt>Difficulty</dt>
              <dd>
                {attempt.problem.difficulty.charAt(0) +
                  attempt.problem.difficulty.slice(1).toLowerCase()}
              </dd>
            </div>
            {attempt.confidence !== null ? (
              <div>
                <dt>Confidence</dt>
                <dd>{labels[attempt.confidence]}</dd>
              </div>
            ) : null}
            {attempt.optimality !== null ? (
              <div>
                <dt>Solution quality</dt>
                <dd>{labels[attempt.optimality]}</dd>
              </div>
            ) : null}
            {attempt.timeSpentSeconds !== null ? (
              <div>
                <dt>Time spent</dt>
                <dd>
                  {Math.floor(attempt.timeSpentSeconds / 60)}m {attempt.timeSpentSeconds % 60}s
                </dd>
              </div>
            ) : null}
            <div>
              <dt>Next review</dt>
              <dd>
                {reviewDate
                  ? formatPracticeDate(reviewDate)
                  : attempt.nextAction?.type === "TRANSFER"
                    ? "Fresh pattern transfer"
                    : "No exact redo scheduled"}
              </dd>
            </div>
            {attempt.patterns && attempt.patterns.length > 0 ? (
              <div className="history-long-detail">
                <dt>Revealed patterns</dt>
                <dd>{attempt.patterns.join(", ")}</dd>
              </div>
            ) : null}
          </dl>
          {attempt.approach ? (
            <section className="history-reading">
              <h4>Approach</h4>
              <p>{attempt.approach}</p>
            </section>
          ) : null}
          {attempt.notes ? (
            <section className="history-reading">
              <h4>Notes</h4>
              <p>{attempt.notes}</p>
            </section>
          ) : null}
          {attempt.summary ? (
            <section className="history-reading" aria-label="Learning checkpoint">
              {attempt.summary.finalUnderstanding ? (
                <>
                  <h4>What I learned</h4>
                  <p>{attempt.summary.finalUnderstanding}</p>
                </>
              ) : null}
              <details>
                <summary>More learning details</summary>
                <p className="detail-caption">
                  {attempt.summary.reviewedAt
                    ? `Reviewed ${new Date(attempt.summary.reviewedAt).toLocaleString()}`
                    : "Not yet reviewed"}
                </p>
                <dl className="history-facts history-summary-facts">
                  {(
                    [
                      ["Approach", attempt.summary.approach],
                      ["Stuck point", attempt.summary.stuckPoint],
                      ["Misconception", attempt.summary.misconception],
                      ["Assistance", attempt.summary.assistance],
                      ["What helped", attempt.summary.progressTrigger],
                      ["Next teaching action", attempt.summary.nextTeachingAction],
                    ] as const
                  )
                    .filter(([, value]) => value !== null)
                    .map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                </dl>
              </details>
            </section>
          ) : null}
          <details className="history-extra-details">
            <summary>Attempt facts and follow-up</summary>
            <dl className="history-facts">
              <div>
                <dt>Started</dt>
                <dd>{new Date(attempt.startedAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt>Confirmed</dt>
                <dd>{new Date(attempt.confirmedAt).toLocaleString()}</dd>
              </div>
              {attempt.assistance.length > 0 ? (
                <div>
                  <dt>Assistance</dt>
                  <dd>
                    {attempt.assistance
                      .map(
                        (event) =>
                          `${labels[event.type]}${event.hintLevel === null ? "" : ` (${tutorHintNames[event.hintLevel - 1] ?? "Guidance step"})`}`,
                      )
                      .join(", ")}
                  </dd>
                </div>
              ) : null}
              {attempt.reproducedFromMemory !== null ? (
                <div>
                  <dt>Reproduced from memory</dt>
                  <dd>{attempt.reproducedFromMemory ? "Yes" : "No"}</dd>
                </div>
              ) : null}
              {attempt.solutionReviewedAt !== null ? (
                <div>
                  <dt>Solution reviewed</dt>
                  <dd>{new Date(attempt.solutionReviewedAt).toLocaleString()}</dd>
                </div>
              ) : null}
              {attempt.timerSkippedAt !== null ? (
                <div>
                  <dt>Timer skipped</dt>
                  <dd>{new Date(attempt.timerSkippedAt).toLocaleString()}</dd>
                </div>
              ) : null}
            </dl>
            {review !== null ? (
              <ReviewDateForm
                apiUrl={apiUrl}
                token={token}
                attemptId={attempt.id}
                review={review}
                onSaved={(updated) => setReview(updated.review)}
              />
            ) : null}
            {attempt.nextAction?.type === "COMPLETE" ? (
              <p className="history-follow-up-detail">Completed with no automatic follow-up.</p>
            ) : null}
            {attempt.nextAction?.type === "TRANSFER" ? (
              <div className="history-follow-up-detail">
                <h3>Fresh {attempt.nextAction.pattern} transfer</h3>
                <p>
                  {attempt.nextAction.dueDate
                    ? `Eligible from ${formatPracticeDate(attempt.nextAction.dueDate)}`
                    : "Eligible 7 calendar days after the practice date"}
                  .
                </p>
                <p>Destination selected when scheduled.</p>
              </div>
            ) : null}
          </details>
        </div>
      </DetailDialog>
    </li>
  );
}

function formatPracticeDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
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
    <nav className="history-pagination" aria-label="Attempt history pages">
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
