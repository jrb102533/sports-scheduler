import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays } from 'lucide-react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/Button';
import type { AvailabilityCollection, League, UserProfile } from '@/types';

interface OpenCollection {
  collection: AvailabilityCollection;
  league: League;
  hasResponded: boolean;
}

interface Props {
  profile: UserProfile;
  leagues: League[];
  coachTeamLeagueIds: string[];
}

function daysUntilLabel(isoDate: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(isoDate);
  due.setHours(0, 0, 0, 0);
  const days = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `Due in ${days} days`;
}

export function CoachAvailabilityCard({ profile, leagues, coachTeamLeagueIds }: Props) {
  const navigate = useNavigate();
  const [openCollections, setOpenCollections] = useState<OpenCollection[]>([]);

  useEffect(() => {
    if (coachTeamLeagueIds.length === 0) return;

    let cancelled = false;

    async function fetchOpenCollections() {
      const results: OpenCollection[] = [];

      for (const leagueId of coachTeamLeagueIds) {
        const league = leagues.find(l => l.id === leagueId);
        if (!league) continue;

        const snap = await getDocs(
          query(
            collection(db, 'leagues', leagueId, 'availabilityCollections'),
            where('status', '==', 'open')
          )
        );

        for (const docSnap of snap.docs) {
          const col = { id: docSnap.id, ...docSnap.data() } as AvailabilityCollection;

          const responseRef = doc(db, 'leagues', leagueId, 'availabilityCollections', col.id, 'responses', profile.uid);
          const responseSnap = await getDoc(responseRef);
          const hasResponded = responseSnap.exists();

          results.push({ collection: col, league, hasResponded });
        }
      }

      if (!cancelled) {
        setOpenCollections(results);
      }
    }

    fetchOpenCollections();
    return () => { cancelled = true; };
  }, [coachTeamLeagueIds, leagues, profile.uid]);

  if (openCollections.length === 0) return null;

  return (
    <>
      {openCollections.map(({ collection: col, league, hasResponded }) => (
        <div
          key={col.id}
          className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-4 flex items-center gap-4"
        >
          <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
            <CalendarDays size={18} className="text-blue-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-blue-500 font-semibold uppercase tracking-wide mb-0.5">
              Availability Requested
            </p>
            <p className="font-semibold text-gray-900 truncate">{league.name}</p>
            <p className="text-xs text-gray-500 mt-0.5">{daysUntilLabel(col.dueDate)}</p>
          </div>
          <Button
            variant="primary"
            size="sm"
            className="flex-shrink-0"
            onClick={() => navigate(`/leagues/${league.id}/availability/${col.id}`)}
          >
            {hasResponded ? 'Update Availability' : 'Submit My Availability'}
          </Button>
        </div>
      ))}
    </>
  );
}
