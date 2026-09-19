import type {
  AttemptHistoryResponse,
  CatalogProblemDetailsResponse,
} from "@practice-plus-plus/contracts";
import { useEffect, useState } from "react";
import { loadAttemptHistory, loadCatalogProblemDetails } from "../attempts/attemptsApi";
import { HistoryPagination } from "../attempts/AttemptHistory";
import { ReviewDateForm } from "../attempts/ReviewDateForm";

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

export function CatalogProblemDetails({
  apiUrl,
  token,
  problemId,
  onBack,
}: {
  readonly apiUrl: string;
  readonly token: string;
  readonly problemId: string;
  readonly onBack: () => void;
}) {
  const [details, setDetails] = useState<CatalogProblemDetailsResponse>();
  const [history, setHistory] = useState<AttemptHistoryResponse>();
  const [pageNumber, setPageNumber] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    setDetails(undefined);
    setHistory(undefined);
    void Promise.all([
      loadCatalogProblemDetails(apiUrl, token, problemId),
      loadAttemptHistory(apiUrl, token, { page: pageNumber, problemId }),
    ])
      .then(([problemDetails, attemptHistory]) => {
        if (!active) return;
        setDetails(problemDetails);
        setHistory(attemptHistory);
      })
      .catch((reason: unknown) => {
        if (active)
          setError(reason instanceof Error ? reason.message : "Unable to load problem details.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [apiUrl, pageNumber, problemId, reload, token]);

  return (
    <section
      className="catalog-problem-details page-surface"
      aria-labelledby="problem-details-heading"
    >
      <button
        className="secondary-button catalog-problem-details-back"
        type="button"
        onClick={onBack}
      >
        Back to catalog
      </button>
      {loading ? <p role="status">Loading problem details…</p> : null}
      {error ? (
        <div className="catalog-empty">
          <p className="auth-message" role="alert">
            {error}
          </p>
          <button type="button" onClick={() => setReload((value) => value + 1)}>
            Try again
          </button>
        </div>
      ) : null}
      {details !== undefined && history !== undefined ? (
        <>
          <header className="catalog-problem-details-header">
            <div>
              <p className="attempt-phase-label">Solved problem</p>
              <h3 id="problem-details-heading">
                {details.problem.leetcodeId}. {details.problem.title}
              </h3>
              <p className="settings-help">
                {labelForDifficulty(details.problem.difficulty)}
                {details.problem.availability === "PAID_ONLY" ? " · Premium" : " · Free"}
              </p>
            </div>
            <a href={details.problem.url} target="_blank" rel="noreferrer">
              Open on LeetCode
            </a>
          </header>
          <section className="catalog-problem-details-section" aria-labelledby="patterns-heading">
            <h4 id="patterns-heading">Patterns</h4>
            <ul className="catalog-pattern-list">
              {details.patterns.map((pattern) => (
                <li key={pattern}>{pattern}</li>
              ))}
            </ul>
          </section>
          <section
            className="catalog-problem-details-section"
            aria-labelledby="problem-attempts-heading"
          >
            <h4 id="problem-attempts-heading">Your attempt history</h4>
            {history.totalPages > 0 ? (
              <HistoryPagination
                disabled={loading}
                currentPage={history.page}
                totalPages={history.totalPages}
                onPageChange={setPageNumber}
              />
            ) : null}
            {history.attempts.length === 0 ? (
              <p>No confirmed attempts for this problem.</p>
            ) : (
              <ol className="history-list catalog-attempt-history">
                {history.attempts.map((attempt) => (
                  <li key={attempt.id}>
                    <h5>
                      {labels[attempt.outcome]} · {attempt.type === "FRESH" ? "Fresh" : "Redo"}
                    </h5>
                    <p>Practice date: {attempt.practiceDate}</p>
                    {attempt.review !== null ? (
                      <ReviewDateForm
                        apiUrl={apiUrl}
                        token={token}
                        attemptId={attempt.id}
                        review={attempt.review}
                      />
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
                              {Math.floor(attempt.timeSpentSeconds / 60)}m{" "}
                              {attempt.timeSpentSeconds % 60}s
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
                                    `${labels[event.type]}${event.hintLevel === null ? "" : ` (${event.hintLevel})`}`,
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
            )}
          </section>
        </>
      ) : null}
    </section>
  );
}

function labelForDifficulty(difficulty: string): string {
  return difficulty.charAt(0) + difficulty.slice(1).toLocaleLowerCase();
}
