import { useEffect, useRef, useState } from "react";

import { deleteAccount } from "./accountApi";
import { closeOnBackdropClick } from "../../shared/dialog";

export function DeleteAccountDialog({
  apiUrl,
  token,
  open,
  onClose,
  onDeleted,
}: {
  readonly apiUrl: string;
  readonly token: string;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onDeleted: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (open) {
      setConfirmation("");
      setError(undefined);
      dialog.current?.showModal();
    } else {
      dialog.current?.close();
    }
  }, [open]);

  async function submit() {
    if (deleting || confirmation !== "DELETE") return;
    setDeleting(true);
    setError(undefined);
    try {
      await deleteAccount(apiUrl, token, confirmation);
      await onDeleted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to delete your account.");
      setDeleting(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="delete-account-dialog"
      aria-labelledby="delete-account-title"
      onClose={onClose}
      onClick={deleting ? undefined : closeOnBackdropClick}
      onCancel={(event) => {
        if (deleting) event.preventDefault();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        aria-busy={deleting}
      >
        <h2 id="delete-account-title">Delete your account?</h2>
        <p>
          Your sign-in account and all personal practice data will be permanently deleted. This
          cannot be undone. Administrator accounts cannot be deleted here.
        </p>
        <p>
          A minimal record of the old account ID and deletion time is retained to prevent account
          recreation by old requests.
        </p>
        <label>
          Type DELETE to confirm
          <input
            value={confirmation}
            disabled={deleting}
            autoComplete="off"
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>
        {error ? (
          <p className="auth-message" role="alert">
            {error}
          </p>
        ) : null}
        <div className="account-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={deleting}
            onClick={() => dialog.current?.close()}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="danger-button"
            disabled={deleting || confirmation !== "DELETE"}
          >
            {deleting ? "Deleting account…" : "Delete account permanently"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
