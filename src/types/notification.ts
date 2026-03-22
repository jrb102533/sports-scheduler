export type NotificationType = 'event_reminder' | 'result_recorded' | 'roster_change' | 'attendance_missing' | 'info';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  relatedEventId?: string;
  relatedTeamId?: string;
  isRead: boolean;
  createdAt: string;
}
