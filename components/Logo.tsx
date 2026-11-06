/** Kestrel mark: a swept wing over a horizon line. */
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M3 19c6-1 10-5 13-12 1 6 4 10 13 12-7 0-11 1-13 6-2-5-6-6-13-6z" fill="currentColor" />
      <path d="M6 28h20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".45" />
    </svg>
  );
}
