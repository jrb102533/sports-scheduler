export interface DateRange {
  startDate: string; // "YYYY-MM-DD"
  endDate: string;   // "YYYY-MM-DD"
  note?: string;
}

export interface LeagueAvailabilityRequest {
  id: string;
  leagueId: string;
  seasonStart: string; // "YYYY-MM-DD"
  seasonEnd: string;   // "YYYY-MM-DD"
  deadline: string;    // "YYYY-MM-DD"
  status: 'open' | 'closed';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CoachAvailability {
  id: string; // leagueId_teamId
  leagueId: string;
  teamId: string;
  coachId: string;
  requestId: string;
  unavailableDates: DateRange[];  // hard constraints
  preferredDates: DateRange[];    // soft constraints
  preferredDaysOfWeek: number[];  // 0–6
  preferredTimeStart?: string;    // "HH:mm"
  preferredTimeEnd?: string;      // "HH:mm"
  submittedAt?: string;
  updatedAt: string;
}
