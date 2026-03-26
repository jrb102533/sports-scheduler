export interface AvailabilitySlot {
  dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday
  startTime: string; // "HH:mm" 24h
  endTime: string;   // "HH:mm" 24h
}

export interface Venue {
  id: string;
  leagueId: string;
  name: string;
  address?: string;
  capacity: number; // simultaneous games/fields
  availabilitySlots: AvailabilitySlot[];
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
