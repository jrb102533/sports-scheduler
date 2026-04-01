interface LogoOptionCProps {
  size?: number;
  variant?: 'light' | 'dark';
}

/**
 * Option C — The Signal Icon
 * Concentric arcs (whistle tip + broadcast signal) + title-case wordmark.
 * dark variant: navy arcs, navy/orange wordmark (white backgrounds)
 * light variant: orange arcs, white wordmark (dark backgrounds)
 */
export function LogoOptionC({ size = 160, variant = 'dark' }: LogoOptionCProps) {
  const arcColor = variant === 'dark' ? '#1B3A6B' : '#f97316';
  const dotColor = variant === 'dark' ? '#f97316' : '#FFFFFF';
  const wordmarkPrimary = variant === 'dark' ? '#1B3A6B' : '#FFFFFF';
  const wordmarkAccent = '#f97316';

  const height = Math.round(44 * (size / 160));

  return (
    <svg
      width={size}
      height={height}
      viewBox="0 0 160 44"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="First Whistle logo"
    >
      {/* Signal icon — dot + 3 concentric arcs, fading opacity creates depth */}
      <circle cx="8" cy="22" r="3.5" fill={dotColor} />
      <path d="M14 14 Q22 22 14 30" stroke={arcColor} strokeWidth="3" strokeLinecap="round" fill="none" />
      <path d="M19 9 Q31 22 19 35" stroke={arcColor} strokeWidth="2.5" strokeLinecap="round" fill="none" opacity="0.7" />
      <path d="M24 4 Q40 22 24 40" stroke={arcColor} strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.4" />

      <text
        x="52"
        y="17"
        fontFamily="system-ui, -apple-system, sans-serif"
        fontSize="13"
        fontWeight="400"
        letterSpacing="0.03em"
        fill={wordmarkPrimary}
        dominantBaseline="middle"
      >
        First
      </text>
      <text
        x="52"
        y="32"
        fontFamily="system-ui, -apple-system, sans-serif"
        fontSize="15"
        fontWeight="600"
        letterSpacing="0.02em"
        fill={wordmarkAccent}
        dominantBaseline="middle"
      >
        Whistle
      </text>
    </svg>
  );
}
