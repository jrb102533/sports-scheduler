export interface VenueField {
  id: string;
  name: string; // e.g. "Field 1", "Diamond A", "North Pitch"
}

export interface RecurringVenueWindow {
  dayOfWeek: number; // 0=Sun, 1=Mon, ..., 6=Sat
  startTime: string; // "HH:MM"
  endTime: string;   // "HH:MM"
}

export interface Venue {
  id: string;
  ownerUid: string;
  name: string;
  address: string;
  lat?: number;
  lng?: number;
  isOutdoor: boolean;
  fields: VenueField[];
  /** @deprecated — availability now lives at schedule level (scheduleConfig subcollection). Optional for backwards compat. */
  defaultAvailabilityWindows?: RecurringVenueWindow[];
  /** @deprecated — blackouts now live at schedule level (scheduleConfig subcollection). Optional for backwards compat. */
  defaultBlackoutDates?: string[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string; // soft delete: set = deleted; absent = active
}
