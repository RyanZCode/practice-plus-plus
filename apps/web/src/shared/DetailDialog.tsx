import { useEffect, useId, useRef, type ReactNode } from "react";

export function DetailDialog({
  open,
  title,
  subtitle,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  subtitle: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (!open) {
      element?.close();
      return;
    }
    element?.showModal();
    if (element) element.scrollTop = 0;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      element?.close();
      document.body.style.overflow = overflow;
    };
  }, [open]);

  return (
    <dialog ref={dialog} className="detail-dialog" aria-labelledby={titleId} onClose={onClose}>
      <header className="detail-dialog-heading">
        <div>
          <h3 id={titleId}>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <button type="button" className="secondary-button" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="detail-dialog-content">{children}</div>
    </dialog>
  );
}
