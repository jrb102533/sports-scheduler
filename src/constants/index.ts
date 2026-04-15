import type { SportType, AgeGroup, Team } from '@/types';

export const STORAGE_KEYS = {
  TEAMS: 'sportsScheduler_teams',
  PLAYERS: 'sportsScheduler_players',
  EVENTS: 'sportsScheduler_events',
  NOTIFICATIONS: 'sportsScheduler_notifications',
  NOTIFIED_EVENTS: 'sportsScheduler_notifiedEvents',
  SETTINGS: 'sportsScheduler_settings',
  ATTENDANCE_NOTIFIED: 'sportsScheduler_notifiedAttendance',
} as const;

export const SPORT_TYPE_LABELS: Record<SportType, string> = {
  soccer: 'Soccer',
  basketball: 'Basketball',
  baseball: 'Baseball',
  softball: 'Softball',
  volleyball: 'Volleyball',
  football: 'Football',
  hockey: 'Hockey',
  tennis: 'Tennis',
  other: 'Other',
};

export const SPORT_TYPES: SportType[] = [
  'soccer', 'basketball', 'baseball', 'softball',
  'volleyball', 'football', 'hockey', 'tennis', 'other',
];

export const AGE_GROUPS: AgeGroup[] = ['U6', 'U8', 'U10', 'U12', 'U14', 'U16', 'U18', 'adult'];

export const AGE_GROUP_LABELS: Record<AgeGroup, string> = {
  U6: 'Under 6',
  U8: 'Under 8',
  U10: 'Under 10',
  U12: 'Under 12',
  U14: 'Under 14',
  U16: 'Under 16',
  U18: 'Under 18',
  adult: 'Adult League',
};

export const EVENT_TYPE_LABELS = {
  game: 'Game',
  match: 'Match',
  practice: 'Practice',
  tournament: 'Tournament',
  other: 'Other',
} as const;

export const EVENT_STATUS_LABELS = {
  scheduled: 'Scheduled',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  postponed: 'Postponed',
  draft: 'Draft',
} as const;

export const EVENT_STATUS_COLORS = {
  scheduled: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
  postponed: 'bg-gray-100 text-gray-600',
  draft: 'bg-gray-100 text-gray-500',
} as const;

export const PLAYER_STATUS_LABELS = {
  active: 'Active',
  injured: 'Injured',
  suspended: 'Suspended',
  inactive: 'Inactive',
} as const;

export const EVENT_TYPE_COLORS: Record<string, string> = {
  game: '#2563eb',
  match: '#2563eb',
  practice: '#059669',
  tournament: '#7c3aed',
  other: '#6b7280',
};

export const EVENT_TYPE_BADGE_CLASSES: Record<string, string> = {
  game: 'bg-red-100 text-red-700',
  match: 'bg-red-100 text-red-700',
  practice: 'bg-blue-100 text-blue-700',
  tournament: 'bg-purple-100 text-purple-700',
  other: 'bg-gray-100 text-gray-600',
};

// Full 36-color palette organised into 6 semantic rows.
// TEAM_COLOR_PALETTE is the source of truth; TEAM_COLORS is kept for
// backwards-compat (default color seeding, tests).
export const TEAM_COLOR_PALETTE: { hex: string; name: string }[][] = [
  // Row 1 — Reds & Pinks
  [
    { hex: '#DC143C', name: 'Crimson' },
    { hex: '#E53E3E', name: 'Red' },
    { hex: '#FF6347', name: 'Tomato' },
    { hex: '#FF7F7F', name: 'Coral' },
    { hex: '#E91E8C', name: 'Rose' },
    { hex: '#FF1493', name: 'Hot Pink' },
  ],
  // Row 2 — Oranges & Yellows
  [
    { hex: '#CC5500', name: 'Burnt Orange' },
    { hex: '#F97316', name: 'Orange' },
    { hex: '#F59E0B', name: 'Amber' },
    { hex: '#EAB308', name: 'Gold' },
    { hex: '#FBBF24', name: 'Yellow' },
    { hex: '#84CC16', name: 'Lime' },
  ],
  // Row 3 — Greens
  [
    { hex: '#15803D', name: 'Forest' },
    { hex: '#22C55E', name: 'Kelly' },
    { hex: '#10B981', name: 'Emerald' },
    { hex: '#0D9488', name: 'Teal' },
    { hex: '#00A86B', name: 'Jade' },
    { hex: '#708238', name: 'Olive' },
  ],
  // Row 4 — Blues
  [
    { hex: '#1E3A5F', name: 'Navy' },
    { hex: '#2563EB', name: 'Royal Blue' },
    { hex: '#0047AB', name: 'Cobalt' },
    { hex: '#0EA5E9', name: 'Sky Blue' },
    { hex: '#56A0D3', name: 'Carolina' },
    { hex: '#818CF8', name: 'Periwinkle' },
  ],
  // Row 5 — Purples & Maroons
  [
    { hex: '#800000', name: 'Maroon' },
    { hex: '#800020', name: 'Burgundy' },
    { hex: '#7C3AED', name: 'Purple' },
    { hex: '#8B5CF6', name: 'Violet' },
    { hex: '#4F46E5', name: 'Indigo' },
    { hex: '#8E4585', name: 'Plum' },
  ],
  // Row 6 — Neutrals & Specialty
  [
    { hex: '#111111', name: 'Black' },
    { hex: '#374151', name: 'Charcoal' },
    { hex: '#64748B', name: 'Slate' },
    { hex: '#9CA3AF', name: 'Silver' },
    { hex: '#92400E', name: 'Brown' },
    { hex: '#134E4A', name: 'Dark Teal' },
  ],
];

export const TEAM_COLORS = TEAM_COLOR_PALETTE.flat().map(c => c.hex);

export const SPORT_FORFEIT_THRESHOLDS: Record<SportType, number> = {
  soccer: 7,
  basketball: 5,
  baseball: 9,
  softball: 9,
  volleyball: 6,
  football: 8,
  hockey: 7,
  tennis: 1,
  other: 7,
};

export function getAttendanceThreshold(team: Team | undefined): number {
  if (!team) return 7;
  if (team.attendanceWarningThreshold !== undefined) return team.attendanceWarningThreshold;
  return SPORT_FORFEIT_THRESHOLDS[team.sportType] ?? 7;
}

export function isAttendanceWarningEnabled(team: Team | undefined): boolean {
  return team?.attendanceWarningsEnabled !== false; // default true
}
