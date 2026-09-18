import type {
  PatternEvidence,
  PatternEvidenceResponse,
  StreakCalendarResponse,
} from "@practice-plus-plus/contracts";
import { useEffect, useState } from "react";
import { loadAnalytics, loadStreakCalendar } from "./analyticsApi";

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

  return <AnalyticsView analytics={analytics} apiUrl={apiUrl} token={token} />;
}

export function AnalyticsView({
  analytics,
  apiUrl,
  token,
}: {
  analytics: PatternEvidenceResponse;
  apiUrl?: string;
  token?: string;
}) {
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

      {apiUrl === undefined || token === undefined ? null : (
        <StreakCalendar apiUrl={apiUrl} token={token} />
      )}

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

function StreakCalendar({ apiUrl, token }: { apiUrl: string; token: string }) {
  const [calendar, setCalendar] = useState<StreakCalendarResponse>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState<string>();
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    void loadStreakCalendar(apiUrl, token, month)
      .then((result) => {
        if (active) setCalendar(result);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : "Unable to load streak calendar.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [apiUrl, token, month, reload]);

  if (loading && calendar === undefined)
    return (
      <section className="streak-section page-surface" aria-labelledby="streak-heading">
        <h2 id="streak-heading">Daily target streak</h2>
        <p role="status">Loading streak calendar…</p>
      </section>
    );
  if (error !== undefined && calendar === undefined)
    return (
      <section className="streak-section page-surface" aria-labelledby="streak-heading">
        <h2 id="streak-heading">Daily target streak</h2>
        <p className="auth-message" role="alert">
          {error}
        </p>
        <button type="button" onClick={() => setReload((value) => value + 1)}>
          Try again
        </button>
      </section>
    );
  if (calendar === undefined) return null;

  const currentMonth = calendar.asOfPracticeDate.slice(0, 7);
  return (
    <StreakCalendarView
      calendar={calendar}
      {...(error === undefined ? {} : { error })}
      loading={loading}
      nextDisabled={calendar.month >= currentMonth}
      onPreviousMonth={() => setMonth(shiftMonth(calendar.month, -1))}
      onNextMonth={() => setMonth(shiftMonth(calendar.month, 1))}
    />
  );
}

export function StreakCalendarView({
  calendar,
  error,
  loading = false,
  nextDisabled = false,
  onPreviousMonth,
  onNextMonth,
}: {
  calendar: StreakCalendarResponse;
  error?: string;
  loading?: boolean;
  nextDisabled?: boolean;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
}) {
  const firstWeekday = new Date(`${calendar.month}-01T00:00:00.000Z`).getUTCDay();
  const monthLabel = formatMonth(calendar.month);
  const streakLabel = `${calendar.currentStreak} ${calendar.currentStreak === 1 ? "day" : "days"}`;

  return (
    <section className="streak-section page-surface" aria-labelledby="streak-heading">
      <div className="streak-heading">
        <div>
          <h2 id="streak-heading">Daily target streak</h2>
          <p>
            Complete every saved plan item to fulfill a practice day. This streak is motivational
            context, not a skill score.
          </p>
        </div>
        <div className="streak-stat" aria-label={`Current streak: ${streakLabel}`}>
          <strong>{calendar.currentStreak}</strong>
          <span>current streak</span>
        </div>
      </div>

      <div className="streak-calendar-toolbar">
        <button className="secondary-button" type="button" onClick={onPreviousMonth}>
          Previous month
        </button>
        <h3 aria-live="polite">{monthLabel}</h3>
        <button
          className="secondary-button"
          type="button"
          disabled={nextDisabled}
          onClick={onNextMonth}
        >
          Next month
        </button>
      </div>

      {loading ? <p role="status">Loading month…</p> : null}
      {error === undefined ? null : (
        <p className="auth-message" role="alert">
          {error}
        </p>
      )}

      <div
        className="streak-calendar-grid"
        role="grid"
        aria-label={`${monthLabel} daily target calendar`}
      >
        {weekdayLabels.map((label) => (
          <span className="streak-weekday" role="columnheader" key={label}>
            {label}
          </span>
        ))}
        {Array.from({ length: firstWeekday }, (_, index) => (
          <span
            className="streak-day streak-day-empty"
            role="gridcell"
            aria-hidden="true"
            key={`empty-${index}`}
          />
        ))}
        {calendar.days.map((day) => {
          const label = streakDayLabel(day);
          return (
            <span
              aria-current={day.isCurrent ? "date" : undefined}
              aria-label={label}
              className={`streak-day streak-day-${day.status.toLowerCase()}${
                day.isCurrent ? " streak-day-today" : ""
              }`}
              data-status={day.status}
              role="gridcell"
              title={label}
              key={day.date}
            >
              <strong>{Number(day.date.slice(-2))}</strong>
              {day.requiredCount === null ? null : (
                <small>
                  {day.completedCount} / {day.requiredCount}
                </small>
              )}
            </span>
          );
        })}
      </div>

      <ul className="streak-legend" aria-label="Calendar legend">
        <li>
          <span className="streak-legend-swatch streak-swatch-completed" aria-hidden="true" />
          Completed
        </li>
        <li>
          <span className="streak-legend-swatch streak-swatch-missed" aria-hidden="true" />
          Missed
        </li>
        <li>
          <span className="streak-legend-swatch streak-swatch-current" aria-hidden="true" />
          Current
        </li>
        <li>
          <span className="streak-legend-swatch streak-swatch-neutral" aria-hidden="true" />
          No practice available
        </li>
        <li>
          <span className="streak-legend-swatch streak-swatch-future" aria-hidden="true" />
          Future
        </li>
      </ul>

      {calendar.trackingStartDate === null ? (
        <p className="streak-note">Tracking begins after your first practice plan is generated.</p>
      ) : (
        <p className="streak-note">
          Tracking started {formatDate(calendar.trackingStartDate)}. Neutral days do not extend or
          break the streak.
        </p>
      )}
    </section>
  );
}

const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function formatMonth(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}-01T00:00:00.000Z`));
}

function shiftMonth(value: string, amount: number) {
  const date = new Date(`${value}-01T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + amount);
  return `${date.getUTCFullYear().toString().padStart(4, "0")}-${(date.getUTCMonth() + 1)
    .toString()
    .padStart(2, "0")}`;
}

function streakDayLabel(day: StreakCalendarResponse["days"][number]) {
  const counts =
    day.requiredCount === null ? "" : ` ${day.completedCount} of ${day.requiredCount} completed.`;
  const current = day.isCurrent ? " Current practice day." : "";
  switch (day.status) {
    case "COMPLETED":
      return `${formatDate(day.date)}. Completed.${counts}${current}`;
    case "MISSED":
      return `${formatDate(day.date)}. Missed.${counts}`;
    case "CURRENT":
      return `${formatDate(day.date)}. In progress.${counts}`;
    case "NEUTRAL":
      return `${formatDate(day.date)}. ${
        day.neutralReason === "NO_PRACTICE_AVAILABLE"
          ? "No practice available."
          : "Neutral boundary transition."
      }${current}`;
    case "UNTRACKED":
      return `${formatDate(day.date)}. Not tracked yet.`;
    case "FUTURE":
      return `${formatDate(day.date)}. Future practice day.`;
  }
}
