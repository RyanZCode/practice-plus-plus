import type { Attempt, ReviewObligation } from "@practice-plus-plus/contracts";
import { useId, useState } from "react";
import { overrideReview } from "./attemptsApi";

export function ReviewDateForm({
  apiUrl,
  token,
  attemptId,
  review,
  onSaved,
}: {
  apiUrl: string;
  token: string;
  attemptId: string;
  review: ReviewObligation;
  onSaved?: (attempt: Attempt) => void;
}) {
  const [saved, setSaved] = useState(review);
  const [date, setDate] = useState(review.manualDueDate ?? review.generatedDueDate);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const errorId = useId();
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
        onSaved?.(result);
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
      aria-busy={saving}
      onSubmit={(event) => {
        event.preventDefault();
        void save(date);
      }}
    >
      <h3>Review date</h3>
      <p className="review-saved-date">
        Saved date: {savedDate}
        {saved.manualDueDate !== null ? " (manual override)" : ""}
      </p>
      <p className="review-generated-date">Generated date: {saved.generatedDueDate}</p>
      <label>
        Next review date
        <input
          type="date"
          required
          value={date}
          disabled={saving}
          aria-describedby={error === undefined ? undefined : errorId}
          onChange={(event) => {
            setDate(event.target.value);
            setMessage(undefined);
            setError(undefined);
          }}
        />
      </label>
      <div className="account-actions">
        <button type="submit" disabled={saving || !changed}>
          {saving ? "Saving…" : "Save date"}
        </button>
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
      {message ? <p role="status">{message}</p> : null}
      {error ? (
        <p className="auth-message" id={errorId} role="alert">
          {error} Your date has not been saved.
        </p>
      ) : null}
    </form>
  );
}
