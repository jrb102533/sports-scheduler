import { useState } from 'react';
import { useTeamStore } from '@/store/useTeamStore';
import { useSeasonStore } from '@/store/useSeasonStore';
import { useDivisionStore } from '@/store/useDivisionStore';
import type { Team } from '@/types';

interface TeamPickerProps {
  leagueId: string;
  sportType?: string;
  selectedTeamIds: string[];
  onChange: (ids: string[]) => void;
  currentUserId: string;
}

type PickerTab = 'previous' | 'mine' | 'search' | 'invite';

const TAB_LABELS: Record<PickerTab, string> = {
  previous: 'Previous Season',
  mine: 'My Teams',
  search: 'Search',
  invite: 'Invite',
};

interface TeamCheckboxListProps {
  teams: Team[];
  selectedTeamIds: string[];
  onChange: (ids: string[]) => void;
  emptyMessage: string;
}

function TeamCheckboxList({ teams, selectedTeamIds, onChange, emptyMessage }: TeamCheckboxListProps) {
  function toggleTeam(id: string) {
    if (selectedTeamIds.includes(id)) {
      onChange(selectedTeamIds.filter(tid => tid !== id));
    } else {
      onChange([...selectedTeamIds, id]);
    }
  }

  if (teams.length === 0) {
    return <p className="text-xs text-gray-400 italic px-3 py-4">{emptyMessage}</p>;
  }

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden max-h-52 overflow-y-auto">
      {teams.map(team => (
        <label
          key={team.id}
          className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-gray-50 border-b border-gray-100 last:border-0"
        >
          <input
            type="checkbox"
            checked={selectedTeamIds.includes(team.id)}
            onChange={() => toggleTeam(team.id)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <div
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: team.color }}
          />
          <span className="text-sm text-gray-800">{team.name}</span>
        </label>
      ))}
    </div>
  );
}

export function TeamPicker({
  leagueId: _leagueId,
  sportType,
  selectedTeamIds,
  onChange,
  currentUserId,
}: TeamPickerProps) {
  const [activeTab, setActiveTab] = useState<PickerTab>('previous');
  const [searchQuery, setSearchQuery] = useState('');

  const allTeams = useTeamStore(s => s.teams);
  const seasons = useSeasonStore(s => s.seasons);
  const divisions = useDivisionStore(s => s.divisions);

  // Tab 1 — Previous Season
  // seasons from useSeasonStore are already ordered by createdAt desc (from the store's query).
  // Skip the first (most recent/current) season and use the next one.
  const previousSeason = seasons.length > 1 ? seasons[1] : null;
  const previousSeasonTeamIds = previousSeason
    ? divisions
        .filter(d => d.seasonId === previousSeason.id)
        .flatMap(d => d.teamIds)
    : [];
  const previousSeasonTeams = allTeams.filter(
    t => !t.isPending && !t.isDeleted && previousSeasonTeamIds.includes(t.id),
  );

  // Tab 2 — My Teams
  const myTeams = allTeams.filter(
    t =>
      !t.isPending &&
      !t.isDeleted &&
      t.createdBy === currentUserId &&
      (!t.sportType || !sportType || t.sportType === sportType),
  );

  // Tab 3 — Search
  const searchResults =
    searchQuery.trim().length > 0
      ? allTeams.filter(
          t =>
            !t.isPending &&
            !t.isDeleted &&
            (!sportType || t.sportType === sportType) &&
            t.name.toLowerCase().includes(searchQuery.toLowerCase()),
        )
      : [];

  const tabs: PickerTab[] = ['previous', 'mine', 'search', 'invite'];

  return (
    <div>
      {/* Tab bar */}
      <div
        className="flex border-b border-gray-200 mb-3"
        role="tablist"
        aria-label="Team picker tabs"
      >
        {tabs.map(tab => (
          <button
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls={`team-picker-panel-${tab}`}
            id={`team-picker-tab-${tab}`}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors ${
              activeTab === tab
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      <div
        role="tabpanel"
        id={`team-picker-panel-previous`}
        aria-labelledby={`team-picker-tab-previous`}
        hidden={activeTab !== 'previous'}
      >
        <TeamCheckboxList
          teams={previousSeasonTeams}
          selectedTeamIds={selectedTeamIds}
          onChange={onChange}
          emptyMessage="No previous season found"
        />
      </div>

      <div
        role="tabpanel"
        id={`team-picker-panel-mine`}
        aria-labelledby={`team-picker-tab-mine`}
        hidden={activeTab !== 'mine'}
      >
        <TeamCheckboxList
          teams={myTeams}
          selectedTeamIds={selectedTeamIds}
          onChange={onChange}
          emptyMessage="You haven't created any teams yet"
        />
      </div>

      <div
        role="tabpanel"
        id={`team-picker-panel-search`}
        aria-labelledby={`team-picker-tab-search`}
        hidden={activeTab !== 'search'}
      >
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Type a team name to search"
          aria-label="Search teams by name"
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-2"
        />
        {searchQuery.trim().length === 0 ? (
          <p className="text-xs text-gray-400 italic px-1">Type a team name to search</p>
        ) : (
          <TeamCheckboxList
            teams={searchResults}
            selectedTeamIds={selectedTeamIds}
            onChange={onChange}
            emptyMessage="No teams found"
          />
        )}
      </div>

      <div
        role="tabpanel"
        id={`team-picker-panel-invite`}
        aria-labelledby={`team-picker-tab-invite`}
        hidden={activeTab !== 'invite'}
      >
        <div className="space-y-3">
          <textarea
            rows={4}
            placeholder="Paste email addresses (one per line)"
            aria-label="Email addresses to invite"
            disabled
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-gray-50 text-gray-400 cursor-not-allowed resize-none"
          />
          <button
            type="button"
            disabled
            className="w-full px-4 py-2 text-sm font-medium text-gray-400 bg-gray-100 border border-gray-200 rounded-lg cursor-not-allowed"
          >
            Invite — coming soon
          </button>
        </div>
      </div>
    </div>
  );
}
