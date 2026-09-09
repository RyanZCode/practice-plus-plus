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
      <h2>Attempt history</h2>
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
      <div className="account-actions">
        {pages.length > 1 ? (
          <button
            type="button"
            disabled={loading}
            onClick={() => setPages((value) => value.slice(0, -1))}
          >
            Newer attempts
          </button>
        ) : null}
        {page?.next ? (
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              if (page.next) setPages([...pages, page.next]);
            }}
          >
            Older attempts
          </button>
        ) : null}
      </div>
    </section>
  );
}
