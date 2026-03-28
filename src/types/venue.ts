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
  defaultAvailabilityWindows: RecurringVenueWindow[];
  defaultBlackoutDates: string[]; // ISO date strings
  notes?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string; // soft delete: set = deleted; absent = active
}
