export interface LeagueBlackout {
  id: string;
  leagueId: string;
  label: string;
  startDate: string; // "YYYY-MM-DD"
  endDate: string;   // "YYYY-MM-DD"
  venueId?: string;  // undefined = applies to all venues
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
