import Link from "next/link";

export default function NotFound() {
  return (
    <main className="state-panel panel">
      <span className="kicker">404 / not found</span>
      <h2>This proof surface does not exist</h2>
      <p>Return to the seeded PolicyTwin workspace.</p>
      <div className="state-actions">
        <Link className="primary" href="/">
          Open Policy Studio
        </Link>
      </div>
    </main>
  );
}
