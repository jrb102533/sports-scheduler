import { Trophy } from 'lucide-react';
import { StandingsTable } from '@/components/standings/StandingsTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { useTeamStore } from '@/store/useTeamStore';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';

export function StandingsPage() {
  const teams = useTeamStore(s => s.teams);
  const navigate = useNavigate();

  if (teams.length === 0) {
    return (
      <div className="p-6">
        <EmptyState
          icon={<Trophy size={40} />}
          title="No standings yet"
          description="Add teams and record game results to see standings."
          action={<Button onClick={() => navigate('/teams')}>Go to Teams</Button>}
        />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <p className="text-xs text-gray-400 mt-0.5">Points: Win = 3, Draw = 1, Loss = 0. Based on completed games/matches.</p>
        </div>
        <StandingsTable />
      </div>
    </div>
  );
}
