import AvatarHero from "@/components/AvatarHero";
import ModelHub from "@/components/ModelHub";

const PRODUCTION_URL = "https://ultron-app-web.luo-chat-ops.workers.dev/";

const LAYERS: ReadonlyArray<readonly [string, string]> = [
  ["Brain runtime", "Local inference, verified model cache and explicit resource limits."],
  ["Connector registry", "Capability-scoped access with visible connection and permission state."],
  ["Tool sandbox", "Side effects run through approved, isolated and auditable actions."],
  ["Artifact workspace", "Generated files, reports and builds stay attached to their work."],
];

export default function HomePage() {
  return (
    <main className="ultron-shell">
      <aside className="ultron-rail" aria-label="ULTRON console navigation">
        <div>
          <div className="ultron-wordmark">ULTRON</div>
          <div className="ultron-tagline">Owner console · Secondary web surface</div>
        </div>

        <nav className="ultron-nav" aria-label="Page sections">
          <a href="#overview">Overview</a>
          <a href="#avatar">Avatar</a>
          <a href="#model-hub">Model Hub</a>
          <a href="#architecture">Architecture</a>
        </nav>

        <div className="ultron-status">
          <span className="ultron-dot ultron-dot--preview" aria-hidden="true" />
          Secondary Next.js console
          <a className="ultron-status-link" href={PRODUCTION_URL} target="_blank" rel="noreferrer">
            Open production app ↗
          </a>
          <small>Production web and Android share the apps/phone client.</small>
        </div>
      </aside>

      <div className="ultron-main">
        <header id="overview" className="ultron-page-head">
          <p className="ultron-eyebrow">OWNER WORKSPACE / SECONDARY CONSOLE</p>
          <div className="ultron-page-title-row">
            <div>
              <h1 className="ultron-h1">ULTRON</h1>
              <p className="ultron-sub">
                A local-first AI agent workspace for model connections, avatar presence and system architecture.
                Production chat, tools and task workflows live in the shared web and Android client.
              </p>
            </div>
            <a className="ultron-btn ultron-btn--ghost ultron-production-link" href={PRODUCTION_URL} target="_blank" rel="noreferrer">
              Open production app ↗
            </a>
          </div>
        </header>

        <section id="avatar" className="ultron-console-section" aria-labelledby="avatar-heading">
          <div className="ultron-section-head">
            <div>
              <p className="ultron-eyebrow">CORE / PRESENCE</p>
              <h2 id="avatar-heading">ULTRON avatar</h2>
              <p>Preview the 3D face, scene and expression controls in this secondary console.</p>
            </div>
          </div>
          <div className="ultron-avatar-stage">
            <AvatarHero />
          </div>
        </section>

        <section id="model-hub" className="ultron-console-section" aria-label="Model Hub">
          <ModelHub />
        </section>

        <section id="architecture" className="ultron-console-section" aria-labelledby="architecture-heading">
          <div className="ultron-section-head">
            <div>
              <p className="ultron-eyebrow">SYSTEM MAP</p>
              <h2 id="architecture-heading">Built in layers</h2>
              <p>Separate runtime, integrations, execution and artifacts so every capability has a clear boundary.</p>
            </div>
          </div>

          <div className="ultron-grid">
            {LAYERS.map(([title, body], index) => (
              <article
                key={title}
                className="ultron-card ultron-reveal"
                style={{ ["--reveal-delay" as string]: `${120 + index * 90}ms` }}
              >
                <span className="ultron-card-index">0{index + 1}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
