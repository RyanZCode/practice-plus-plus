import type { PatternEvidence, PatternEvidenceResponse } from "@practice-plus-plus/contracts";
import { useEffect, useState } from "react";
import { loadAnalytics } from "./analyticsApi";

const classificationLabels = {
  UNTESTED: "Untested",
  INSUFFICIENT_EVIDENCE: "Building evidence",
  NEEDS_PRACTICE: "Needs practice",
  NO_CURRENT_WEAKNESS_SIGNAL: "No current weakness signal",
} as const;

const classificationOrder = {
  NEEDS_PRACTICE: 0,
  UNTESTED: 1,
  INSUFFICIENT_EVIDENCE: 2,
  NO_CURRENT_WEAKNESS_SIGNAL: 3,
} as const;

export function Analytics({ apiUrl, token }: { apiUrl: string; token: string }) {
  const [analytics, setAnalytics] = useState<PatternEvidenceResponse>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    void loadAnalytics(apiUrl, token)
      .then((result) => {
        if (active) setAnalytics(result);
      })
      .catch((reason: unknown) => {
        if (active)
          setError(reason instanceof Error ? reason.message : "Unable to load analytics.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [apiUrl, token, reload]);

  if (loading) return <p role="status">Loading analytics…</p>;
  if (error !== undefined)
    return (
      <div className="page-surface">
        <p className="auth-message" role="alert">
          {error}
        </p>
        <button type="button" onClick={() => setReload((value) => value + 1)}>
          Try again
        </button>
      </div>
    );
  if (analytics === undefined) return null;

  return <AnalyticsView analytics={analytics} />;
}

export function AnalyticsView({ analytics }: { analytics: PatternEvidenceResponse }) {
  const patterns = [...analytics.patterns].sort(comparePatterns);
  const { summary } = analytics;
  const overdue = summary.reviewWork.overdueExactRedos + summary.reviewWork.overdueTransfers;
  const dueToday = summary.reviewWork.dueTodayExactRedos + summary.reviewWork.dueTodayTransfers;
  const redoAttempts =
    summary.redo.outcomes.independent +
    summary.redo.outcomes.assisted +
    summary.redo.outcomes.gaveUp;
  const knownOptimality = summary.optimality.optimal + summary.optimality.suboptimal;
  const concentrated = patterns.filter((pattern) => pattern.overconcentrated);

  return (
    <section className="analytics-page" aria-labelledby="analytics-heading">
      <header className="analytics-heading">
        <div>
          <h2 id="analytics-heading">Practice analytics</h2>
          <p>Evidence through practice date {formatDate(analytics.asOfPracticeDate)}.</p>
        </div>
        <p className={`review-work-summary${overdue > 0 ? " review-work-overdue" : ""}`}>
          <strong>{overdue}</strong> overdue review {overdue === 1 ? "item" : "items"}
          <span>{dueToday} due today</span>
        </p>
      </header>

      <div className="analytics-summary-grid">
        <MetricCard
          title="Fresh outcomes"
          value={`${summary.freshOutcomes.independent} independent`}
          detail={`${summary.freshOutcomes.assisted} assisted, ${summary.freshOutcomes.gaveUp} gave up`}
        />
        <MetricCard
          title="Exact redo retention"
          value={formatPercent(summary.redo.successRate)}
          detail={`${redoAttempts} completed redos, ${summary.redo.outcomes.incomplete} incomplete`}
        />
        <MetricCard
          title="Known solution quality"
          value={
            knownOptimality === 0
              ? "No known ratings"
              : `${formatPercent(summary.optimality.optimal / knownOptimality)} optimal`
          }
          detail={`${summary.optimality.suboptimal} suboptimal, ${summary.optimality.unknownOrOmitted} unknown or omitted`}
        />
        <MetricCard
          title="Recent concentration"
          value={`${concentrated.length} ${concentrated.length === 1 ? "pattern" : "patterns"}`}
          detail={
            concentrated.length === 0
              ? "No concentration signal"
              : concentrated.map((pattern) => pattern.patternName).join(", ")
          }
        />
      </div>

      <section
        className="analytics-section page-surface"
        aria-labelledby="pattern-evidence-heading"
      >
        <div className="analytics-section-heading">
          <div>
            <h3 id="pattern-evidence-heading">Pattern priorities</h3>
            <p>Use these signals to decide where fresh practice will be most useful.</p>
          </div>
          <span>{patterns.length} patterns</span>
        </div>
        <div className="analytics-table-scroll">
          <table className="analytics-table">
            <thead>
              <tr>
                <th scope="col">Pattern</th>
                <th scope="col">Evidence</th>
                <th scope="col">Fresh outcomes</th>
                <th scope="col">Last practiced</th>
                <th scope="col">Recent exposure</th>
              </tr>
            </thead>
            <tbody>
              {patterns.map((pattern) => (
                <tr key={pattern.patternId}>
                  <th scope="row">{pattern.patternName}</th>
                  <td>
                    <span
                      className={`evidence-label evidence-${pattern.classification.toLowerCase()}`}
                    >
                      {classificationLabels[pattern.classification]}
                    </span>
                    {pattern.stale ? (
                      <span className="evidence-label evidence-stale">Stale</span>
                    ) : null}
                    <small>{pattern.fresh.sampleCount} of 10 current samples</small>
                  </td>
                  <td>
                    {pattern.fresh.outcomes.independent} independent,{" "}
                    {pattern.fresh.outcomes.assisted} assisted, {pattern.fresh.outcomes.gaveUp} gave
                    up
                  </td>
                  <td>
                    {pattern.lastPracticed === null ? "Never" : formatDate(pattern.lastPracticed)}
                  </td>
                  <td>
                    {pattern.recentExposureShare === null
                      ? "No recent practice"
                      : `${formatPercent(pattern.recentExposureShare)}${pattern.overconcentrated ? ", concentrated" : ""}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="analytics-detail-grid">
        <section className="analytics-section page-surface" aria-labelledby="assistance-heading">
          <h3 id="assistance-heading">Help used</h3>
          <p>Distinct confirmed attempts can appear in more than one category.</p>
          <dl className="metric-list">
            <MetricRow label="Clarification" value={summary.assistance.clarification} />
            <MetricRow label="Conceptual hint" value={summary.assistance.conceptualHint} />
            <MetricRow label="Debugging" value={summary.assistance.debugging} />
            <MetricRow label="Optimization" value={summary.assistance.optimization} />
            <MetricRow label="Solution review" value={summary.assistance.solutionReview} />
          </dl>
        </section>

        <section className="analytics-section page-surface" aria-labelledby="review-heading">
          <h3 id="review-heading">Review workload</h3>
          <p>Open follow-up work relative to your current practice date.</p>
          <dl className="metric-list">
            <MetricRow label="Overdue exact redos" value={summary.reviewWork.overdueExactRedos} />
            <MetricRow label="Overdue transfers" value={summary.reviewWork.overdueTransfers} />
            <MetricRow
              label="Exact redos due today"
              value={summary.reviewWork.dueTodayExactRedos}
            />
            <MetricRow label="Transfers due today" value={summary.reviewWork.dueTodayTransfers} />
          </dl>
          {summary.reviewWork.overdueItems.length > 0 ? (
            <details className="overdue-review-details">
              <summary>
                Show overdue {summary.reviewWork.overdueItems.length === 1 ? "item" : "items"}
              </summary>
              <ol className="overdue-review-list">
                {summary.reviewWork.overdueItems.map((item) => (
                  <li
                    key={
                      item.type === "EXACT_REDO"
                        ? `redo-${item.sourceAttemptId}`
                        : `transfer-${item.transferId}`
                    }
                  >
                    {item.type === "EXACT_REDO" ? (
                      <>
                        <span className="review-kind">Exact redo</span>
                        <a href={item.problem.url} target="_blank" rel="noreferrer">
                          {item.problem.leetcodeId}. {item.problem.title}
                        </a>
                        <small>
                          Due {formatDate(item.dueDate)}, {formatDaysOverdue(item.daysOverdue)}
                        </small>
                      </>
                    ) : (
                      <>
                        <span className="review-kind">Fresh pattern transfer</span>
                        <strong>{item.patternName} transfer</strong>
                        <small>
                          From {item.sourceProblemTitle}. Eligible {formatDate(item.dueDate)},{" "}
                          {formatDaysOverdue(item.daysOverdue)}.
                        </small>
                        <small>No destination is selected until this transfer is scheduled.</small>
                      </>
                    )}
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
        </section>
      </div>

      <details className="analytics-definitions page-surface">
        <summary>Metric definitions</summary>
        <dl>
          <dt>Pattern evidence</dt>
          <dd>
            Uses the latest 10 confirmed, non-incomplete fresh attempts per pattern. Zero samples is
            untested, one to four is building evidence, and five or more permits a directional
            signal. It is not a mastery score.
          </dd>
          <dt>Needs practice</dt>
          <dd>
            More than half of weighted current evidence is assisted, gave up, shaky, or suboptimal.
            Multi-pattern attempts split numerical weight equally across their patterns.
          </dd>
          <dt>Stale</dt>
          <dd>No confirmed, non-incomplete fresh or redo attempt for 30 practice-calendar days.</dd>
          <dt>Recent concentration</dt>
          <dd>
            After at least four qualifying attempts in the last seven practice dates, more than half
            of weighted exposure belongs to one pattern.
          </dd>
          <dt>Fresh outcomes</dt>
          <dd>All confirmed, non-incomplete fresh attempts through the current practice date.</dd>
          <dt>Exact redo retention</dt>
          <dd>
            Independent and assisted redo outcomes divided by all non-incomplete redo outcomes.
            Incomplete redos are shown separately.
          </dd>
          <dt>Help used</dt>
          <dd>
            Distinct confirmed, non-incomplete attempts using each category. One attempt may use
            multiple categories.
          </dd>
          <dt>Solution quality</dt>
          <dd>
            Optimal versus suboptimal among attempts with a known rating. Unknown and omitted
            ratings remain visible and are excluded from the percentage.
          </dd>
          <dt>Overdue review work</dt>
          <dd>
            Unresolved exact redos or pattern transfers with an effective due or eligibility date
            before the current practice date. Items due on the current date are separate.
          </dd>
        </dl>
      </details>
    </section>
  );
}

function MetricCard({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <article className="analytics-card">
      <h3>{title}</h3>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function MetricRow({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function comparePatterns(left: PatternEvidence, right: PatternEvidence) {
  return (
    classificationOrder[left.classification] - classificationOrder[right.classification] ||
    Number(right.stale) - Number(left.stale) ||
    left.patternName.localeCompare(right.patternName)
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(`${value}T00:00:00.000Z`),
  );
}

function formatPercent(value: number | null) {
  return value === null ? "Not enough data" : `${Math.round(value * 100)}%`;
}

function formatDaysOverdue(days: number) {
  return `${days} ${days === 1 ? "day" : "days"} overdue`;
}
