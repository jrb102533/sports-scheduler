import type { SportType } from '@/types';

export const STORAGE_KEYS = {
  TEAMS: 'sportsScheduler_teams',
  PLAYERS: 'sportsScheduler_players',
  EVENTS: 'sportsScheduler_events',
  NOTIFICATIONS: 'sportsScheduler_notifications',
  NOTIFIED_EVENTS: 'sportsScheduler_notifiedEvents',
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
} as const;

export const EVENT_STATUS_COLORS = {
  scheduled: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
  postponed: 'bg-gray-100 text-gray-600',
} as const;

export const PLAYER_STATUS_LABELS = {
  active: 'Active',
  injured: 'Injured',
  inactive: 'Inactive',
} as const;

export const TEAM_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899',
  '#06b6d4', '#84cc16', '#f59e0b', '#6366f1',
];
