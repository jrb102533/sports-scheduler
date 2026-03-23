/**
 * First Whistle brand logo mark — a referee's whistle on a green-teal gradient badge.
 * Used in Sidebar, AuthLayout, and email templates.
 */
interface WhistleLogoProps {
  size?: number;
}

export function WhistleLogo({ size = 36 }: WhistleLogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="wl-bg" x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse">
          <stop stopColor="#15803d"/>
          <stop offset="1" stopColor="#0d9488"/>
        </linearGradient>
      </defs>
      {/* Badge background */}
      <rect width="36" height="36" rx="10" fill="url(#wl-bg)"/>
      {/* Whistle body */}
      <rect x="15" y="12" width="16" height="12" rx="6" fill="white"/>
      {/* Mouthpiece tube */}
      <rect x="6" y="15.5" width="13" height="5" rx="2.5" fill="white"/>
      {/* Lanyard ring */}
      <circle cx="7" cy="18" r="3" fill="none" stroke="white" strokeWidth="1.8"/>
      {/* Pea hole */}
      <circle cx="27" cy="12.5" r="2.5" fill="url(#wl-bg)"/>
      {/* Sound wave */}
      <path d="M32 15.5 Q34.5 18 32 20.5" stroke="white" strokeWidth="1.4" strokeLinecap="round" fill="none" opacity="0.8"/>
    </svg>
  );
}
