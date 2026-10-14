import { useEffect, useState } from "react";
import { loadRecentPractice, practiceDateLabel, type RecentPractice } from "./practiceHistory";

export function RecentPracticePanel({
  apiUrl,
  token,
  refresh,
}: {
  apiUrl: string;
  token: string;
  refresh: number;
}) {
  const [history, setHistory] = useState<RecentPractice>();
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setError(undefined);
    void loadRecentPractice(apiUrl, token)
      .then((result) => {
        if (active) setHistory(result);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Unable to load streak.");
      });
    return () => {
      active = false;
    };
  }, [apiUrl, token, refresh, retry]);

  return (
    <section className="recent-practice page-surface" aria-labelledby="recent-practice-heading">
      <div className="recent-practice-heading">
        <h3 id="recent-practice-heading">Practice streak</h3>
        {history ? (
          <strong>
            {history.currentStreak} {history.currentStreak === 1 ? "day" : "days"}
          </strong>
        ) : null}
      </div>
      {error ? (
        <>
          <p className="auth-message" role="alert">
            {error}
          </p>
          <button type="button" className="secondary-button" onClick={() => setRetry(retry + 1)}>
            Try again
          </button>
        </>
      ) : history ? (
        <>
          <p className="recent-practice-caption">Past 7 days</p>
          <ol className="recent-practice-days">
            {history.days.map((day) => {
              const label = `${practiceDateLabel(day.date, { month: "short" })} ${practiceDateLabel(day.date, { day: "numeric" })}`;
              const tracked = day.completedCount !== null && day.requiredCount !== null;
              const description =
                day.status === "NEUTRAL"
                  ? day.neutralReason === "BOUNDARY_CHANGE"
                    ? "Day boundary changed"
                    : "No practice available"
                  : day.status === "UNTRACKED"
                    ? "Not tracked"
                    : day.status === "COMPLETED"
                      ? "Completed"
                      : "Missed";
              return (
                <li
                  key={day.date}
                  className={`recent-practice-day day-${day.status.toLowerCase()}`}
                >
                  <time dateTime={day.date}>{label}</time>
                  <span className="recent-practice-track" aria-hidden="true">
                    {day.status === "NEUTRAL" || !tracked ? (
                      <span>{day.status === "NEUTRAL" ? "Neutral" : "Not tracked"}</span>
                    ) : (
                      <span
                        className="recent-practice-fill"
                        style={{
                          width: `${day.requiredCount ? (day.completedCount! / day.requiredCount) * 100 : 0}%`,
                        }}
                      />
                    )}
                  </span>
                  <span className="recent-practice-count">
                    {tracked ? `${day.completedCount}/${day.requiredCount}` : "-"}
                    <span className="visually-hidden"> {description}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </>
      ) : (
        <p role="status">Loading recent practice…</p>
      )}
    </section>
  );
}
