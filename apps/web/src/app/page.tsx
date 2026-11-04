import AvatarHero from '@/components/AvatarHero';
import ModelHub from '@/components/ModelHub';

const LAYERS: ReadonlyArray<readonly [string, string]> = [
  ['Brain runtime', 'Local inference, verified model cache.'],
  ['Connector registry', 'Capability-scoped access to the world.'],
  ['Tool sandbox', 'Every side effect isolated and audited.'],
  ['Monetization', 'Meters, entitlements, no hot-path billing.'],
];

export default function HomePage() {
  return (
    <main style={{ maxWidth: 820, margin: '0 auto', padding: '96px 24px' }}>
      <p
        style={{
          fontSize: 12,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--ultron-muted)',
          margin: 0,
        }}
      >
        Pre-alpha
      </p>

      <h1 className="ultron-title-sheen" style={{ fontSize: 52, lineHeight: 1.05, margin: '16px 0 0' }}>
        Ultron
      </h1>

      <p style={{ fontSize: 19, color: 'var(--ultron-muted)', lineHeight: 1.6 }}>
        A local-first AI agent platform. The brain runs on your device. The cloud
        is optional.
      </p>

      <AvatarHero />

      <ModelHub />

      <div
        style={{
          marginTop: 40,
          display: 'grid',
          gap: 12,
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        }}
      >
        {LAYERS.map(([title, body], i) => (
          <div
            key={title}
            className="ultron-reveal ultron-card-hover"
            style={{
              ['--reveal-delay' as string]: `${120 + i * 90}ms`,
              background: 'var(--ultron-surface)',
              border: '1px solid var(--ultron-border)',
              borderRadius: 'var(--ultron-radius)',
              padding: 18,
            }}
          >
            <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>{title}</h2>
            <p
              style={{
                fontSize: 13.5,
                color: 'var(--ultron-muted)',
                margin: 0,
                lineHeight: 1.5,
              }}
            >
              {body}
            </p>
          </div>
        ))}
      </div>
    </main>
  );
}
