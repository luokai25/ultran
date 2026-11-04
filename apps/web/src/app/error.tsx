"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div style={{ padding: 48, maxWidth: 720 }}>
      <div className="ultron-eyebrow">Workspace fault</div>
      <h1 className="ultron-h1">Something broke</h1>
      <p className="ultron-sub">{error.message || "An unexpected error interrupted the workspace."}</p>
      <button className="ultron-btn" onClick={reset}>
        Retry
      </button>
    </div>
  );
}
