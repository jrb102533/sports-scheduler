interface LogoOptionAProps {
  size?: number;
  variant?: 'light' | 'dark';
}

/**
 * Option A — The Starter's Mark
 * Geometric whistle silhouette + bold wordmark.
 * dark variant: navy icon + navy/orange wordmark (white backgrounds)
 * light variant: white icon + white wordmark with orange accent (dark backgrounds)
 */
export function LogoOptionA({ size = 160, variant = 'dark' }: LogoOptionAProps) {
  const iconColor = variant === 'dark' ? '#1B3A6B' : '#FFFFFF';
  const wordmarkPrimary = variant === 'dark' ? '#1B3A6B' : '#FFFFFF';
  const wordmarkAccent = '#f97316';
  const height = Math.round(48 * (size / 160));

  return (
    <svg
      width={size}
      height={height}
      viewBox="0 0 160 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="First Whistle logo"
    >
      <rect x="0" y="16" width="10" height="14" rx="2" fill={iconColor} />
      <ellipse cx="26" cy="23" rx="16" ry="11" fill={iconColor} />
      <circle cx="26" cy="23" r="4" fill={variant === 'dark' ? '#FFFFFF' : '#1B3A6B'} />

      {/* Sound wave arcs — orange accent to the right of the body */}
      <path
        d="M44 17 Q50 23 44 29"
        stroke={wordmarkAccent}
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M48 13 Q57 23 48 33"
        stroke={wordmarkAccent}
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
        opacity="0.6"
      />

      <text
        x="68"
        y="20"
        fontFamily="system-ui, -apple-system, sans-serif"
        fontSize="11"
        fontWeight="400"
        letterSpacing="0.12em"
        fill={wordmarkPrimary}
        dominantBaseline="middle"
      >
        FIRST
      </text>
      <text
        x="68"
        y="34"
        fontFamily="system-ui, -apple-system, sans-serif"
        fontSize="14"
        fontWeight="700"
        letterSpacing="0.08em"
        fill={wordmarkAccent}
        dominantBaseline="middle"
      >
        WHISTLE
      </text>
    </svg>
  );
}
