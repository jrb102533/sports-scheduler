import { Trophy, Settings } from 'lucide-react';
import { StandingsTable } from '@/components/standings/StandingsTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { useTeamStore } from '@/store/useTeamStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';

export function StandingsPage() {
  const teams = useTeamStore(s => s.teams);
  const { settings } = useSettingsStore();
  const navigate = useNavigate();

  if (settings.kidsSportsMode && settings.hideStandingsInKidsMode) {
    return (
      <div className="p-6">
        <EmptyState
          icon={<Trophy size={40} />}
          title="Standings are hidden"
          description="Standings are turned off in Kids Sports Mode. You can change this in Settings."
          action={<Button variant="secondary" onClick={() => navigate('/settings')}><Settings size={15} /> Go to Settings</Button>}
        />
      </div>
    );
  }

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
      <div className="flex items-center gap-2 mb-6">
        <Trophy size={20} className="text-amber-500" />
        <h1 className="text-xl font-bold text-gray-900">Standings</h1>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/50">
          <p className="text-xs text-gray-400">Win = 3 pts · Draw = 1 pt · Loss = 0 pts · Based on completed games and matches</p>
        </div>
        <StandingsTable />
      </div>
    </div>
  );
}
