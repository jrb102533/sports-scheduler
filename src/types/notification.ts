export type NotificationType =
  | 'event_reminder'
  | 'result_recorded'
  | 'roster_change'
  | 'attendance_missing'
  | 'info'
  | 'weather_alert'
  | 'availability_request'
  // Practice slot notifications (#130)
  | 'practice_slot_confirmed'   // coach's team confirmed into a slot
  | 'practice_slot_waitlisted'  // coach's team waitlisted (capacity full)
  | 'practice_slot_promoted'    // waitlisted team auto-promoted after cancellation
  | 'practice_slot_blackout'    // LM blacked out a date; affected confirmed coaches notified
  | 'practice_slot_cancelled';  // team cancelled (sent to LM for awareness)

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  relatedEventId?: string;
  relatedTeamId?: string;
  relatedLeagueId?: string;
  relatedCollectionId?: string;
  isRead: boolean;
  createdAt: string;
}
