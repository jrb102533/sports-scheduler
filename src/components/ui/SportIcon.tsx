import type { SportType } from '@/types';

interface SportIconProps {
  sport: SportType;
  size?: number;
  className?: string;
}

export function SportIcon({ sport, size = 20, className }: SportIconProps) {
  const props = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
  };

  switch (sport) {
    case 'soccer':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="10" />
          <polygon points="12,6.5 14.5,8.5 13.5,11.5 10.5,11.5 9.5,8.5" fill="currentColor" stroke="none" />
          <line x1="12" y1="2" x2="12" y2="6.5" />
          <line x1="14.5" y1="8.5" x2="18" y2="6" />
          <line x1="9.5" y1="8.5" x2="6" y2="6" />
          <line x1="13.5" y1="11.5" x2="16.5" y2="15" />
          <line x1="10.5" y1="11.5" x2="7.5" y2="15" />
        </svg>
      );

    case 'basketball':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2 C17 5 17 19 12 22" fill="none" />
          <path d="M12 2 C7 5 7 19 12 22" fill="none" />
        </svg>
      );

    case 'baseball':
    case 'softball':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="10" />
          <path d="M9.5 3.5 C7.5 8 7.5 16 9.5 20.5" fill="none" />
          <path d="M14.5 3.5 C16.5 8 16.5 16 14.5 20.5" fill="none" />
          <line x1="9.5" y1="8" x2="12" y2="7" />
          <line x1="9.5" y1="12" x2="12" y2="11" />
          <line x1="9.5" y1="16" x2="12" y2="15" />
          <line x1="14.5" y1="8" x2="12" y2="7" />
          <line x1="14.5" y1="12" x2="12" y2="11" />
          <line x1="14.5" y1="16" x2="12" y2="15" />
        </svg>
      );

    case 'football':
      return (
        <svg {...props}>
          <ellipse cx="12" cy="12" rx="10" ry="6.5" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <line x1="12" y1="9" x2="12" y2="15" />
          <line x1="10" y1="10.5" x2="14" y2="10.5" />
          <line x1="10" y1="13.5" x2="14" y2="13.5" />
        </svg>
      );

    case 'hockey':
      return (
        <svg {...props}>
          <ellipse cx="12" cy="20" rx="5" ry="2" />
          <path d="M9 3 L9 17 Q9 20 12 20" fill="none" />
          <path d="M9 14 L14 17" fill="none" />
        </svg>
      );

    case 'volleyball':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="10" />
          <path d="M2.5 10 Q8 5 12 10 Q16 15 21.5 10" fill="none" />
          <path d="M5 17 Q9 12 12 14 Q15 16 19 11" fill="none" />
        </svg>
      );

    case 'tennis':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="10" />
          <path d="M4 6 Q12 12 4 18" fill="none" />
          <path d="M20 6 Q12 12 20 18" fill="none" />
        </svg>
      );

    default:
      return (
        <svg {...props}>
          <polygon points="12,2 15.1,8.4 22,9.3 17,14.1 18.2,21 12,17.8 5.8,21 7,14.1 2,9.3 8.9,8.4" />
        </svg>
      );
  }
}
