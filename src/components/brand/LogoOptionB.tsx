interface LogoOptionBProps {
  size?: number;
  variant?: 'light' | 'dark';
}

/**
 * Option B — The Whistle Badge
 * Shield badge with diagonal navy/orange split + whistle + wordmark.
 * dark variant: full color on white background
 * light variant: white outline shield, white wordmark on dark backgrounds
 */
export function LogoOptionB({ size = 160, variant = 'dark' }: LogoOptionBProps) {
  const navy = variant === 'dark' ? '#1B3A6B' : '#FFFFFF';
  const orange = '#f97316';
  const whistleColor = variant === 'dark' ? '#FFFFFF' : '#1B3A6B';
  const wordmarkNavy = variant === 'dark' ? '#1B3A6B' : '#FFFFFF';
  const wordmarkOrange = '#f97316';
  const height = Math.round(56 * (size / 160));

  return (
    <svg
      width={size}
      height={height}
      viewBox="0 0 160 56"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="First Whistle logo"
    >
      <clipPath id="shield-clip-b">
        <path d="M4 4 L36 4 L36 36 Q36 48 20 52 Q4 48 4 36 Z" />
      </clipPath>

      {/* Shield — top-left navy half, bottom-right orange triangle clipped to shield shape */}
      <path d="M4 4 L36 4 L36 36 Q36 48 20 52 Q4 48 4 36 Z" fill={navy} />
      <polygon
        points="36,4 36,52 4,52"
        fill={orange}
        clipPath="url(#shield-clip-b)"
      />

      {/* Shield border */}
      <path
        d="M4 4 L36 4 L36 36 Q36 48 20 52 Q4 48 4 36 Z"
        stroke={variant === 'dark' ? 'none' : 'rgba(255,255,255,0.3)'}
        strokeWidth="1"
        fill="none"
      />

      <rect x="9" y="23" width="6" height="8" rx="1.5" fill={whistleColor} />
      <ellipse cx="22" cy="27" rx="8" ry="5.5" fill={whistleColor} />
      <circle cx="22" cy="27" r="2" fill={variant === 'dark' ? '#1B3A6B' : '#FFFFFF'} />

      <text
        x="50"
        y="22"
        fontFamily="system-ui, -apple-system, sans-serif"
        fontSize="13"
        fontWeight="800"
        letterSpacing="0.05em"
        fill={wordmarkNavy}
        dominantBaseline="middle"
      >
        FIRST
      </text>
      <text
        x="50"
        y="38"
        fontFamily="system-ui, -apple-system, sans-serif"
        fontSize="13"
        fontWeight="800"
        letterSpacing="0.05em"
        fill={wordmarkOrange}
        dominantBaseline="middle"
      >
        WHISTLE
      </text>
    </svg>
  );
}
