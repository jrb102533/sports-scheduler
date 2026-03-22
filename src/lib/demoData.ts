import { useTeamStore } from '@/store/useTeamStore';
import { usePlayerStore } from '@/store/usePlayerStore';
import { useEventStore } from '@/store/useEventStore';
import type { Team, Player, ScheduledEvent } from '@/types';

export async function seedDemoData() {
  const now = new Date().toISOString();
  const today = new Date();

  const t1: Team = { id: crypto.randomUUID(), name: 'City Hawks', sportType: 'soccer', color: '#3b82f6', homeVenue: 'City Park Field 1', coachName: 'Alex Morgan', coachEmail: 'alex@cityhawks.com', createdBy: 'demo', createdAt: now, updatedAt: now };
  const t2: Team = { id: crypto.randomUUID(), name: 'River Lions', sportType: 'soccer', color: '#ef4444', homeVenue: 'Riverside Stadium', coachName: 'Sam Chen', createdBy: 'demo', createdAt: now, updatedAt: now };

  await useTeamStore.getState().addTeam(t1);
  await useTeamStore.getState().addTeam(t2);

  const makePlayers = (teamId: string, names: [string, string][], startJersey: number): Player[] =>
    names.map(([first, last], i) => ({
      id: crypto.randomUUID(), teamId, firstName: first, lastName: last,
      jerseyNumber: startJersey + i, position: ['Forward', 'Midfielder', 'Defender', 'Goalkeeper'][i % 4],
      status: 'active' as const, createdAt: now, updatedAt: now,
    }));

  const hawks = makePlayers(t1.id, [['Jordan', 'Smith'], ['Taylor', 'Lee'], ['Casey', 'Brown'], ['Morgan', 'Davis'], ['Riley', 'Wilson']], 1);
  const lions = makePlayers(t2.id, [['Jamie', 'Garcia'], ['Quinn', 'Martinez'], ['Avery', 'Thomas'], ['Cameron', 'Anderson'], ['Drew', 'Jackson']], 10);

  await Promise.all([...hawks, ...lions].map(p => usePlayerStore.getState().addPlayer(p)));

  const d = (offset: number) => {
    const date = new Date(today);
    date.setDate(today.getDate() + offset);
    return date.toISOString().split('T')[0];
  };

  const events: ScheduledEvent[] = [
    { id: crypto.randomUUID(), title: 'Hawks vs Lions', type: 'game', status: 'scheduled', date: d(3), startTime: '14:00', endTime: '16:00', location: 'City Park Field 1', homeTeamId: t1.id, awayTeamId: t2.id, teamIds: [t1.id, t2.id], isRecurring: false, createdAt: now, updatedAt: now },
    { id: crypto.randomUUID(), title: 'Hawks Practice', type: 'practice', status: 'scheduled', date: d(1), startTime: '09:00', endTime: '10:30', location: 'City Park Field 1', teamIds: [t1.id], isRecurring: false, createdAt: now, updatedAt: now },
    { id: crypto.randomUUID(), title: 'Lions Practice', type: 'practice', status: 'scheduled', date: d(2), startTime: '10:00', endTime: '11:30', location: 'Riverside Stadium', teamIds: [t2.id], isRecurring: false, createdAt: now, updatedAt: now },
    { id: crypto.randomUUID(), title: 'Lions vs Hawks', type: 'game', status: 'completed', date: d(-7), startTime: '15:00', endTime: '17:00', location: 'Riverside Stadium', homeTeamId: t2.id, awayTeamId: t1.id, teamIds: [t1.id, t2.id], result: { homeScore: 2, awayScore: 1 }, isRecurring: false, createdAt: now, updatedAt: now },
    { id: crypto.randomUUID(), title: 'Hawks vs Lions', type: 'game', status: 'completed', date: d(-14), startTime: '14:00', endTime: '16:00', location: 'City Park Field 1', homeTeamId: t1.id, awayTeamId: t2.id, teamIds: [t1.id, t2.id], result: { homeScore: 3, awayScore: 3 }, isRecurring: false, createdAt: now, updatedAt: now },
    { id: crypto.randomUUID(), title: 'Spring Tournament', type: 'tournament', status: 'scheduled', date: d(10), startTime: '08:00', location: 'Sports Complex', teamIds: [t1.id, t2.id], isRecurring: false, createdAt: now, updatedAt: now },
  ];

  await useEventStore.getState().bulkAddEvents(events);
}
