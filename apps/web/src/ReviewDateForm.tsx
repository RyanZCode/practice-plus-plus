import type { ReviewObligation } from "@practice-plus-plus/contracts";
import { useState } from "react";
import { overrideReview } from "./attemptsApi";

export function ReviewDateForm({
  apiUrl,
  token,
  attemptId,
  review,
}: {
  apiUrl: string;
  token: string;
  attemptId: string;
  review: ReviewObligation;
}) {
  const [saved, setSaved] = useState(review);
  const [date, setDate] = useState(review.manualDueDate ?? review.generatedDueDate);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const savedDate = saved.manualDueDate ?? saved.generatedDueDate;
  const changed = date !== savedDate;

  async function save(value: string | null) {
    setSaving(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const result = await overrideReview(apiUrl, token, attemptId, value);
      if (result.review !== null) {
        setSaved(result.review);
        setDate(result.review.manualDueDate ?? result.review.generatedDueDate);
        setMessage("Review date saved.");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save review date.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="review-date-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save(date);
      }}
    >
      <p>
        Next review: {savedDate}
        {saved.manualDueDate !== null ? " (manual override)" : ""}
        {" · "}Generated date: {saved.generatedDueDate}
      </p>
      <label>
        Next review date
        <input
          type="date"
          required
          value={date}
          disabled={saving}
          onChange={(event) => setDate(event.target.value)}
        />
      </label>
      {changed || saved.manualDueDate !== null ? (
        <div className="account-actions">
          {changed ? (
            <button type="submit" disabled={saving}>
              Save review date
            </button>
          ) : null}
          {saved.manualDueDate !== null ? (
            <button
              className="secondary-button"
              type="button"
              disabled={saving}
              onClick={() => void save(null)}
            >
              Use generated date
            </button>
          ) : null}
        </div>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}
