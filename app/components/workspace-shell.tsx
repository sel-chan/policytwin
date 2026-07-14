import Link from "next/link";
import type { ReactNode } from "react";

const navigation = [
  ["studio", "/", "Policy Studio", "01"],
  ["decisions", "/decisions", "Decision Queue", "02"],
  ["cases", "/cases", "Case Lab", "03"],
  ["integration", "/integration", "Integration / Drift", "04"],
  ["proof", "/proof", "Proof", "05"],
  ["impact", "/impact", "Change Impact", "06"],
] as const;

export function WorkspaceShell({
  active,
  eyebrow,
  title,
  summary,
  actions,
  children,
}: {
  active: (typeof navigation)[number][0];
  eyebrow: string;
  title: string;
  summary: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="PolicyTwin home">
          <span className="brand-mark">PT</span>
          <span><strong>PolicyTwin</strong><small>Policy engineering proof</small></span>
        </Link>
        <nav aria-label="Workspace views">
          {navigation.map(([id, href, label, number]) => (
            <Link
              aria-current={active === id ? "page" : undefined}
              className={active === id ? "nav-item active" : "nav-item"}
              href={href}
              key={id}
            >
              <span>{number}</span>{label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="pulse" aria-hidden="true" />
          <div><strong>Offline evidence active</strong><small>Live GPT + Codex pending</small></div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{summary}</p></div>
          {actions ? <div className="header-actions">{actions}</div> : null}
        </header>
        <div className="workspace">{children}</div>
      </main>
    </div>
  );
}

export function StatusPill({ tone, children }: { tone: "ok" | "warn" | "bad" | "info"; children: ReactNode }) {
  return <span className={`status ${tone}`}>{children}</span>;
}
