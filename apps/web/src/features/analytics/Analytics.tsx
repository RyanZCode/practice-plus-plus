import {
  tutorHintNames,
  type PatternEvidence,
  type PatternEvidenceResponse,
  type StreakCalendarResponse,
} from "@practice-plus-plus/contracts";
import { useEffect, useState } from "react";
import { loadAnalytics, loadStreakCalendar } from "./analyticsApi";
import { DetailDialog } from "../../shared/DetailDialog";

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

export function Analytics({
  apiUrl,
  token,
  isActive = true,
  onProblemHistory,
}: {
  apiUrl: string;
  token: string;
  isActive?: boolean;
  onProblemHistory: (problem: { id: string; title: string }) => void;
}) {
  const [analytics, setAnalytics] = useState<PatternEvidenceResponse>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!isActive) return;
    let active = true;
    setLoading(true);
    setError(undefined);
    void loadAnalytics(apiUrl, token)
      .then((result) => {
        if (active) setAnalytics(result);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Unable to load progress.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [apiUrl, token, reload, isActive]);

  if (loading || error !== undefined)
    return (
      <section className="analytics-page" aria-labelledby="analytics-heading">
        <header className="analytics-heading">
          <h2 id="analytics-heading">Progress</h2>
        </header>
        <div className="page-surface">
          {loading ? (
            <p role="status">Loading progress…</p>
          ) : (
            <>
              <p className="auth-message" role="alert">
                {error}
              </p>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setReload((value) => value + 1)}
              >
                Try again
              </button>
            </>
          )}
        </div>
      </section>
    );
  if (analytics === undefined) return null;
  return (
    <AnalyticsView
      analytics={analytics}
      apiUrl={apiUrl}
      token={token}
      onProblemHistory={onProblemHistory}
    />
  );
}

export function AnalyticsView({
  analytics,
  apiUrl,
  token,
  onProblemHistory,
}: {
  analytics: PatternEvidenceResponse;
  apiUrl?: string;
  token?: string;
  onProblemHistory?: ((problem: { id: string; title: string }) => void) | undefined;
}) {
  const [showUntested, setShowUntested] = useState(false);
  const patterns = [...analytics.patterns].sort(comparePatterns);
  const tested = patterns.filter((pattern) => pattern.classification !== "UNTESTED");
  const untested = patterns.filter((pattern) => pattern.classification === "UNTESTED");
  const { summary } = analytics;
  const overdue = summary.reviewWork.overdueExactRedos + summary.reviewWork.overdueTransfers;
  const dueToday = summary.reviewWork.dueTodayExactRedos + summary.reviewWork.dueTodayTransfers;
  const redoAttempts =
    summary.redo.outcomes.independent +
    summary.redo.outcomes.assisted +
    summary.redo.outcomes.gaveUp;
  const redoSolved = summary.redo.outcomes.independent + summary.redo.outcomes.assisted;
  const freshAttempts =
    summary.freshOutcomes.independent +
    summary.freshOutcomes.assisted +
    summary.freshOutcomes.gaveUp;
  const knownOptimality = summary.optimality.optimal + summary.optimality.suboptimal;
  const concentrated = patterns.filter((pattern) => pattern.overconcentrated);

  return (
    <section className="analytics-page" aria-labelledby="analytics-heading">
      <header className="analytics-heading">
        <h2 id="analytics-heading">Progress</h2>
        <p>As of practice date {formatDate(analytics.asOfPracticeDate)}</p>
      </header>
      {apiUrl === undefined || token === undefined ? null : (
        <StreakCalendar apiUrl={apiUrl} token={token} />
      )}

      <section className="analytics-section page-surface" aria-labelledby="review-heading">
        <h3 id="review-heading">Review workload</h3>
        <div className="review-work-counts">
          <div>
            <strong className={overdue > 0 ? "review-overdue-count" : undefined}>
              {overdue} overdue
            </strong>
            <p>
              {summary.reviewWork.overdueExactRedos} exact{" "}
              {summary.reviewWork.overdueExactRedos === 1 ? "redo" : "redos"} ·{" "}
              {summary.reviewWork.overdueTransfers}{" "}
              {summary.reviewWork.overdueTransfers === 1 ? "transfer" : "transfers"}
            </p>
          </div>
          <div>
            <strong>{dueToday} due today</strong>
            <p>
              {summary.reviewWork.dueTodayExactRedos} exact{" "}
              {summary.reviewWork.dueTodayExactRedos === 1 ? "redo" : "redos"} ·{" "}
              {summary.reviewWork.dueTodayTransfers}{" "}
              {summary.reviewWork.dueTodayTransfers === 1 ? "transfer" : "transfers"}
            </p>
          </div>
        </div>
        {summary.reviewWork.overdueItems.length > 0 ? (
          <details className="overdue-review-details">
            <summary>Overdue items</summary>
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
                      <a href={item.problem.url} target="_blank" rel="noreferrer">
                        {item.problem.leetcodeId}. {item.problem.title}
                      </a>
                      <small>
                        Exact redo · Due {formatDate(item.dueDate)} ·{" "}
                        {formatDaysOverdue(item.daysOverdue)}
                      </small>
                    </>
                  ) : (
                    <>
                      <strong>{item.patternName} transfer</strong>
                      <small>
                        From {item.sourceProblemTitle} · Eligible {formatDate(item.dueDate)} ·{" "}
                        {formatDaysOverdue(item.daysOverdue)}
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

      <section
        className="analytics-section page-surface"
        aria-labelledby="pattern-evidence-heading"
      >
        <div className="analytics-section-heading">
          <h3 id="pattern-evidence-heading">Pattern evidence</h3>
          <span>Fresh attempts · Latest 10 per pattern</span>
        </div>
        {freshAttempts === 0 ? (
          <p className="progress-empty">No confirmed fresh attempts yet.</p>
        ) : null}
        <div className="pattern-row-heading" aria-hidden="true">
          <span>Pattern</span>
          <span>Evidence</span>
          <span>Fresh outcomes</span>
        </div>
        {tested.map((pattern) => (
          <PatternRow
            key={pattern.patternId}
            pattern={pattern}
            onProblemHistory={onProblemHistory}
          />
        ))}
        <div id="untested-patterns" hidden={!showUntested && tested.length > 0}>
          {untested.map((pattern) => (
            <PatternRow
              key={pattern.patternId}
              pattern={pattern}
              onProblemHistory={onProblemHistory}
            />
          ))}
        </div>
        {untested.length > 0 && tested.length > 0 ? (
          <button
            className="pattern-toggle"
            type="button"
            aria-expanded={showUntested}
            aria-controls="untested-patterns"
            onClick={() => setShowUntested(!showUntested)}
          >
            {showUntested ? "Hide" : "Show"} {untested.length} untested{" "}
            {untested.length === 1 ? "pattern" : "patterns"}
          </button>
        ) : null}
        <MetricDefinitions />
      </section>

      <div className="analytics-summary-grid">
        <article className="analytics-card">
          <h3>Fresh outcomes</h3>
          <strong>{summary.freshOutcomes.independent} independent</strong>
          <p>
            {summary.freshOutcomes.assisted} assisted · {summary.freshOutcomes.gaveUp} gave up
          </p>
          <p>{freshAttempts} confirmed fresh attempts</p>
        </article>
        <article className="analytics-card">
          <h3>Exact redo retention</h3>
          <strong>
            {redoAttempts === 0
              ? "Not enough data"
              : `${formatPercent(summary.redo.successRate)} · ${redoSolved} / ${redoAttempts} solved`}
          </strong>
          <p>
            {summary.redo.outcomes.independent} independent · {summary.redo.outcomes.assisted}{" "}
            assisted · {summary.redo.outcomes.gaveUp} gave up
          </p>
        </article>
      </div>

      <details className="analytics-extra page-surface">
        <summary>Help, solution quality and concentration</summary>
        <div className="analytics-detail-grid">
          <section aria-labelledby="assistance-heading">
            <h3 id="assistance-heading">Help used</h3>
            <p>Distinct attempts per category. Categories may overlap.</p>
            <dl className="metric-list">
              <MetricRow label="Clarification" value={summary.assistance.clarification} />
              <MetricRow label="Conceptual hint" value={summary.assistance.conceptualHint} />
              <MetricRow label="Debugging" value={summary.assistance.debugging} />
              <MetricRow label="Optimization" value={summary.assistance.optimization} />
              <MetricRow label="Solution review" value={summary.assistance.solutionReview} />
            </dl>
          </section>
          <section aria-labelledby="quality-heading">
            <h3 id="quality-heading">Known solution quality</h3>
            <p>
              {knownOptimality === 0
                ? "No known ratings"
                : `${formatPercent(summary.optimality.optimal / knownOptimality)} optimal · ${summary.optimality.optimal} / ${knownOptimality} known ratings`}
            </p>
            <p>
              {summary.optimality.suboptimal} suboptimal · {summary.optimality.unknownOrOmitted}{" "}
              unknown or omitted
            </p>
          </section>
          <section aria-labelledby="concentration-heading">
            <h3 id="concentration-heading">Recent concentration</h3>
            <p>
              {concentrated.length === 0
                ? "No concentration signal"
                : concentrated.map((pattern) => pattern.patternName).join(", ")}
            </p>
          </section>
        </div>
      </details>
    </section>
  );
}

function PatternRow({
  pattern,
  onProblemHistory,
}: {
  pattern: PatternEvidence;
  onProblemHistory?: ((problem: { id: string; title: string }) => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const { fresh, redo } = pattern;
  const redoSamples = redo.outcomes.independent + redo.outcomes.assisted + redo.outcomes.gaveUp;
  return (
    <div className="pattern-row">
      <button
        type="button"
        className="pattern-row-trigger"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <strong>{pattern.patternName}</strong>
        <span className="pattern-classification">
          <span
            className={
              pattern.classification === "NEEDS_PRACTICE" ? "review-overdue-count" : undefined
            }
          >
            {classificationLabels[pattern.classification]}
          </span>
          {pattern.stale ? <span className="review-overdue-count"> · Stale</span> : null}
          <small>{fresh.sampleCount} / 10 fresh samples</small>
        </span>
        <span className="pattern-outcomes">
          {fresh.sampleCount === 0
            ? "No fresh attempts"
            : `${fresh.outcomes.independent} independent · ${fresh.outcomes.assisted} assisted · ${fresh.outcomes.gaveUp} gave up`}
        </span>
        <span className="row-chevron" aria-hidden="true">
          ›
        </span>
      </button>
      <DetailDialog
        open={open}
        onClose={() => setOpen(false)}
        title={pattern.patternName}
        subtitle={`${classificationLabels[pattern.classification]}${pattern.stale ? " · Stale" : ""} · ${fresh.sampleCount} / 10 fresh samples`}
      >
        <div className="pattern-details">
          <dl className="progress-facts">
            <div>
              <dt>Fresh outcomes</dt>
              <dd>
                {fresh.outcomes.independent} independent · {fresh.outcomes.assisted} assisted ·{" "}
                {fresh.outcomes.gaveUp} gave up
              </dd>
            </div>
            <div>
              <dt>Exact redos, separate from fresh</dt>
              <dd>
                {redoSamples === 0
                  ? "No completed redos"
                  : `${redo.outcomes.independent + redo.outcomes.assisted} / ${redoSamples} solved (${formatPercent(redo.successRate)})`}
              </dd>
              <dd className="detail-caption">
                {redo.outcomes.independent} independent · {redo.outcomes.assisted} assisted ·{" "}
                {redo.outcomes.gaveUp} gave up
              </dd>
            </div>
            <div>
              <dt>Last practiced, fresh or redo</dt>
              <dd>
                {pattern.lastPracticed === null ? "Never" : formatDate(pattern.lastPracticed)}
              </dd>
            </div>
            <div>
              <dt>Exposure, last 7 practice dates</dt>
              <dd>
                {pattern.recentExposureShare === null
                  ? "No recent practice"
                  : `${formatPercent(pattern.recentExposureShare)} of weighted exposure${pattern.overconcentrated ? ", concentrated" : ""}`}
              </dd>
            </div>
          </dl>
          <details className="pattern-calculation">
            <summary>How this signal is calculated</summary>
            <dl className="progress-facts">
              <div>
                <dt>Fresh evidence weight</dt>
                <dd>
                  {fresh.weightedTotal.toFixed(1)} total · {fresh.weightedWeakSignals.toFixed(1)}{" "}
                  needs practice
                </dd>
              </div>
              {pattern.highestConceptualHintLevel === null ? null : (
                <div>
                  <dt>Highest conceptual hint</dt>
                  <dd>
                    {tutorHintNames[pattern.highestConceptualHintLevel - 1] ?? "Guidance step"}
                  </dd>
                </div>
              )}
            </dl>
            <p className="detail-caption">
              Fresh evidence uses the latest 10 confirmed fresh attempts. Assisted attempts, giving
              up, shaky confidence, and suboptimal solutions count toward the needs-practice signal.
              Multi-pattern attempts split their weight equally.
            </p>
          </details>
          <details className="pattern-problems">
            <summary>Practiced problems ({pattern.problems.length})</summary>
            {pattern.problems.length === 0 ? (
              <p>No confirmed problems in this pattern yet.</p>
            ) : (
              <ol>
                {pattern.problems.map((problem) => (
                  <li key={problem.id}>
                    <button
                      type="button"
                      className="pattern-problem-link"
                      onClick={() => {
                        setOpen(false);
                        onProblemHistory?.(problem);
                      }}
                    >
                      {problem.leetcodeId}. {problem.title}
                    </button>
                    <time dateTime={problem.practiceDate}>{formatDate(problem.practiceDate)}</time>
                  </li>
                ))}
              </ol>
            )}
          </details>
          {fresh.sampleCount < 5 ? (
            <p className="detail-caption">
              At least 5 fresh samples are needed for a directional signal.
            </p>
          ) : null}
        </div>
      </DetailDialog>
    </div>
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

function MetricDefinitions() {
  return (
    <details className="analytics-definitions">
      <summary>Metric definitions</summary>
      <dl>
        <dt>Pattern evidence</dt>
        <dd>
          Uses the latest 10 confirmed fresh attempts per pattern. Zero samples is untested, one to
          four is building evidence, and five or more permits a directional signal. It is not a
          mastery score.
        </dd>
        <dt>Needs practice</dt>
        <dd>
          More than half of weighted current evidence is assisted, gave up, shaky, or suboptimal.
          Multi-pattern attempts split numerical weight equally across their patterns.
        </dd>
        <dt>Samples and weights</dt>
        <dd>
          Each tagged attempt counts as one sample per pattern. Numerical contributions split
          equally across tags. Do not add pattern samples to get an attempt total. Missing optional
          details add no penalty.
        </dd>
        <dt>Stale</dt>
        <dd>No confirmed fresh or redo attempt for 30 practice-calendar days.</dd>
        <dt>Recent concentration</dt>
        <dd>
          After at least four qualifying attempts in the last seven practice dates, more than half
          of weighted exposure belongs to one pattern.
        </dd>
        <dt>Fresh outcomes</dt>
        <dd>All confirmed fresh attempts through the current practice date.</dd>
        <dt>Exact redo retention</dt>
        <dd>
          Independent and assisted redo outcomes divided by all attempts with a recorded result.
        </dd>
        <dt>Help used</dt>
        <dd>
          Distinct attempts with a recorded result using each category. One attempt may use multiple
          categories.
        </dd>
        <dt>Solution quality</dt>
        <dd>
          Optimal versus suboptimal among attempts with a known rating. Unknown and omitted ratings
          remain visible and are excluded from the percentage.
        </dd>
        <dt>Overdue review work</dt>
        <dd>
          Unresolved exact redos or pattern transfers with an effective due or eligibility date
          before the current practice date. Items due on the current date are separate.
        </dd>
      </dl>
    </details>
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
        <h2 id="streak-heading">Consistency</h2>
        <p role="status">Loading calendar…</p>
      </section>
    );
  if (error !== undefined && calendar === undefined)
    return (
      <section className="streak-section page-surface" aria-labelledby="streak-heading">
        <h2 id="streak-heading">Consistency</h2>
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
      onRetry={() => setReload((value) => value + 1)}
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
  onRetry,
}: {
  calendar: StreakCalendarResponse;
  error?: string;
  loading?: boolean;
  nextDisabled?: boolean;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
  onRetry?: () => void;
}) {
  const firstWeekday = new Date(`${calendar.month}-01T00:00:00.000Z`).getUTCDay();
  const monthLabel = formatMonth(calendar.month);
  const streakLabel = `${calendar.currentStreak} ${calendar.currentStreak === 1 ? "day" : "days"}`;

  return (
    <section className="streak-section page-surface" aria-labelledby="streak-heading">
      <div className="analytics-section-heading">
        <h3 id="streak-heading">Consistency</h3>
        <span>Daily target completion</span>
      </div>
      <div className="streak-layout">
        <div>
          <div className="streak-calendar-toolbar">
            <button
              className="secondary-button"
              type="button"
              aria-label="Previous month"
              disabled={loading}
              onClick={onPreviousMonth}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m15 6-6 6 6 6" />
              </svg>
            </button>
            <h4 aria-live="polite">{monthLabel}</h4>
            <button
              className="secondary-button"
              type="button"
              aria-label="Next month"
              disabled={loading || nextDisabled}
              onClick={onNextMonth}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m9 6 6 6-6 6" />
              </svg>
            </button>
          </div>
          {loading ? <p role="status">Loading month…</p> : null}
          {error === undefined ? null : (
            <div className="calendar-error">
              <p className="auth-message" role="alert">
                {error}
              </p>
              {onRetry ? (
                <button
                  className="secondary-button"
                  type="button"
                  disabled={loading}
                  onClick={onRetry}
                >
                  Try again
                </button>
              ) : null}
            </div>
          )}
          <div
            className="streak-calendar-grid"
            role="group"
            aria-label={`${monthLabel} daily completion`}
            aria-busy={loading}
          >
            {weekdayLabels.map((label) => (
              <span className="streak-weekday" aria-hidden="true" key={label}>
                {label}
              </span>
            ))}
            {Array.from({ length: firstWeekday }, (_, index) => (
              <span className="streak-day-empty" aria-hidden="true" key={`empty-${index}`} />
            ))}
            {calendar.days.map((day) => {
              const label = streakDayLabel(day);
              return (
                <span
                  aria-current={day.isCurrent ? "date" : undefined}
                  aria-label={label}
                  className={`streak-day streak-day-${day.status.toLowerCase()}${day.isCurrent ? " streak-day-today" : ""}`}
                  data-status={day.status}
                  role="img"
                  title={label}
                  key={day.date}
                >
                  <strong>
                    {Number(day.date.slice(-2))}
                    {day.status === "COMPLETED" ? " ✓" : day.status === "NEUTRAL" ? " −" : ""}
                  </strong>
                  {day.requiredCount === null || day.status === "NEUTRAL" ? null : (
                    <small>
                      {day.completedCount}/{day.requiredCount}
                    </small>
                  )}
                </span>
              );
            })}
          </div>
          <ul className="streak-legend" aria-label="Calendar legend">
            <li>
              <span className="streak-legend-swatch streak-swatch-completed" aria-hidden="true" />✓
              Completed
            </li>
            <li>
              <span className="streak-legend-swatch streak-swatch-partial" aria-hidden="true" />
              Partial
            </li>
            <li>
              <span className="streak-legend-swatch streak-swatch-missed" aria-hidden="true" />
              Missed
            </li>
            <li>
              <span className="streak-legend-swatch streak-swatch-current" aria-hidden="true" />
              Current
            </li>
          </ul>
        </div>
        <div className="streak-context">
          <div className="streak-stat" aria-label={`Current streak: ${streakLabel}`}>
            <strong>{streakLabel}</strong>
            <span>Current streak</span>
          </div>
          <p className="streak-note">
            {calendar.trackingStartDate === null
              ? "Tracking begins after your first practice plan is generated."
              : `Tracking since ${formatDate(calendar.trackingStartDate)}.`}
          </p>
          <details className="completion-rules">
            <summary>Completion rules</summary>
            <p>
              Confirmed independent, assisted, and gave-up attempts count toward the day's target,
              including manual and extra practice. Counts can exceed the target.
            </p>
            <p>
              Completed days meet or exceed the target. Partial days fall below it. Tracked days
              with no attempts show 0/target, even if no plan was generated. Partial and missed days
              break the streak after the day ends.
            </p>
          </details>
        </div>
      </div>
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
    case "PARTIAL":
      return `${formatDate(day.date)}. Partial.${counts}${current}`;
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
