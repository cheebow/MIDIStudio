// App mark: a keyboard with the orange playhead, on the accent blue (same drawing as public/favicon.svg).
export function Logo({ size = 48 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="MIDI Studio" className="app-logo">
      <rect x="2" y="2" width="60" height="60" rx="14" fill="#2f6fdb" />
      <rect x="12" y="24" width="40" height="28" rx="3" fill="#ffffff" />
      <path d="M22 24v28M32 24v28M42 24v28" stroke="#d5d9e0" strokeWidth="1.5" />
      <rect x="18.5" y="24" width="7" height="17" fill="#1d2330" />
      <rect x="28.5" y="24" width="7" height="17" fill="#1d2330" />
      <rect x="38.5" y="24" width="7" height="17" fill="#1d2330" />
      <rect x="12" y="12" width="40" height="6" rx="3" fill="#ffffff" opacity="0.55" />
      <rect x="35" y="8" width="3" height="48" rx="1.5" fill="#f2994a" />
    </svg>
  );
}
