export function LoadingStatus({ children }: { children: React.ReactNode }) {
  return (
    <span className="loading-status" role="status">
      <span className="loading-spinner" aria-hidden="true" />
      {children}
    </span>
  );
}
