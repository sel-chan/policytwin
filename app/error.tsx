"use client";

export default function ErrorState({ reset }: { reset: () => void }) {
  return (
    <main className="state-panel panel" role="alert">
      <span className="kicker">Workspace error</span>
      <h2>Evidence could not be loaded</h2>
      <p>The workspace failed closed. Regenerate the offline evidence package, then retry.</p>
      <div className="state-actions">
        <button className="primary" type="button" onClick={reset}>
          Retry
        </button>
      </div>
    </main>
  );
}
