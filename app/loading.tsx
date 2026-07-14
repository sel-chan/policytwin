export default function Loading() {
  return (
    <main className="state-panel panel" aria-busy="true" aria-live="polite">
      <span className="kicker">Loading evidence</span>
      <h2>Preparing the workspace</h2>
      <div className="loading-bars" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </main>
  );
}
