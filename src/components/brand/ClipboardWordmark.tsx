interface ClipboardWordmarkProps {
  size?: number;
  variant?: 'dark' | 'light';
  className?: string;
}

/**
 * First Whistle clipboard wordmark.
 * Clipboard with navy "F" + orange "W" lockup on the paper.
 * - dark variant:  navy clipboard, white paper, navy "F" + orange "W"  (use on white/light bg)
 * - light variant: white clipboard, navy paper,  white "F" + orange "W" (use on navy/dark bg)
 */
export function ClipboardWordmark({
  size = 28,
  variant = 'dark',
  className,
}: ClipboardWordmarkProps) {
  const isLight = variant === 'light';

  const board       = isLight ? '#FFFFFF'           : '#1B3A6B';
  const boardShine  = isLight ? 'rgba(0,0,0,0.06)'  : 'rgba(255,255,255,0.08)';
  const paper       = isLight ? '#1B3A6B'           : '#FFFFFF';
  const clip        = isLight ? '#E2E8F0'           : '#0F2A52';
  const clipPea     = '#F97316';
  const letterF     = isLight ? '#FFFFFF'           : '#1B3A6B';
  const letterW     = '#F97316';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="First Whistle"
      style={{ display: 'block' }}
    >
      <rect x="8"  y="12" width="48" height="48" rx="5" fill={board} />
      <rect x="8"  y="12" width="48" height="6"  rx="5" fill={boardShine} />
      <rect x="13" y="18" width="38" height="38" rx="2" fill={paper} />
      <rect x="22" y="6"  width="20" height="12" rx="2" fill={clip} />
      <rect x="26" y="3"  width="12" height="5"  rx="2.5" fill={clipPea} />
      <text
        x="32" y="46"
        textAnchor="middle"
        fontFamily="Inter, system-ui, sans-serif"
        fontWeight="900" fontSize="24" letterSpacing="-2"
      >
        <tspan fill={letterF}>F</tspan>
        <tspan fill={letterW}>W</tspan>
      </text>
    </svg>
  );
}

interface ClipboardMarkProps {
  size?: number;
  variant?: 'dark' | 'light';
  className?: string;
}

/**
 * Compact First Whistle clipboard mark — icon only, no wordmark beside it.
 * Optimized for 24–56px use (sidebar, avatar, favicon).
 * The FW fills more of the paper; clip detail simplified for legibility.
 */
export function ClipboardMark({
  size = 40,
  variant = 'dark',
  className,
}: ClipboardMarkProps) {
  const isLight = variant === 'light';
  const board   = isLight ? '#FFFFFF' : '#1B3A6B';
  const paper   = isLight ? '#1B3A6B' : '#FFFFFF';
  const clip    = isLight ? '#CBD5E1' : '#0F2A52';
  const pea     = '#F97316';
  const letterF = isLight ? '#FFFFFF' : '#1B3A6B';
  const letterW = '#F97316';

  return (
    <svg
      width={size} height={size} viewBox="0 0 64 64"
      className={className} role="img" aria-label="First Whistle"
      style={{ display: 'block' }}
    >
      <rect x="6"  y="14" width="52" height="46" rx="6" fill={board} />
      <rect x="11" y="20" width="42" height="36" rx="3" fill={paper} />
      <rect x="22" y="8"  width="20" height="10" rx="2" fill={clip} />
      <rect x="26" y="5"  width="12" height="5"  rx="2.5" fill={pea} />
      <text
        x="32" y="48"
        textAnchor="middle"
        fontFamily="Inter, system-ui, sans-serif"
        fontWeight="900" fontSize="30" letterSpacing="-2.5"
      >
        <tspan fill={letterF}>F</tspan>
        <tspan fill={letterW}>W</tspan>
      </text>
    </svg>
  );
}
