export function AuroraLogo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-label="Aurora" role="img">
      <defs>
        <linearGradient id="aurora-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6d5ef6" />
          <stop offset="1" stopColor="#22c7d6" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#aurora-g)" />
      <path
        d="M7 22c3-8 6-12 9-12s6 4 9 12"
        stroke="#fff"
        strokeWidth="2.6"
        fill="none"
        strokeLinecap="round"
      />
      <circle cx="16" cy="10" r="2.2" fill="#fff" />
    </svg>
  );
}

export function AuroraBrandLarge() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <AuroraLogo size={48} />
      <div style={{ fontSize: 22, fontWeight: 700 }}>Aurora Analytics</div>
    </div>
  );
}
