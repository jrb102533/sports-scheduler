import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, CalendarDays } from 'lucide-react';
import { CoachAvailabilityForm } from '@/components/leagues/CoachAvailabilityForm';
import { useLeagueStore } from '@/store/useLeagueStore';
import { useCollectionStore } from '@/store/useCollectionStore';
import { useAuthStore } from '@/store/useAuthStore';
import { useTeamStore } from '@/store/useTeamStore';
import { getMemberships } from '@/store/useAuthStore';

export function CoachAvailabilityPage() {
  const { leagueId, collectionId } = useParams<{ leagueId: string; collectionId: string }>();
  const navigate = useNavigate();

  const leagues = useLeagueStore(s => s.leagues);
  const teams = useTeamStore(s => s.teams);
  const profile = useAuthStore(s => s.profile);
  const { activeCollection, responses, loadCollection } = useCollectionStore();

  useEffect(() => {
    if (!leagueId) return;
    return loadCollection(leagueId);
  }, [leagueId, loadCollection]);

  const league = leagues.find(l => l.id === leagueId);

  const coachTeam = teams.find(t => {
    if (!profile) return false;
    if (t.leagueId !== leagueId) return false;
    if (t.coachId === profile.uid) return true;
    return getMemberships(profile).some(m => m.role === 'coach' && m.teamId === t.id);
  });

  const collection = activeCollection?.id === collectionId ? activeCollection : null;

  const existingResponse = responses.find(r => r.coachUid === profile?.uid);

  if (!league || !collection || !profile || !coachTeam) {
    return (
      <div className="p-4 sm:p-6">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4"
        >
          <ArrowLeft size={14} /> Back to Dashboard
        </button>
        <p className="text-gray-500 text-sm">
          {!league ? 'League not found.' : !collection ? 'This availability collection is no longer open.' : 'You are not a coach in this league.'}
        </p>
      </div>
    );
  }

  if (collection.status !== 'open') {
    return (
      <div className="p-4 sm:p-6">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4"
        >
          <ArrowLeft size={14} /> Back to Dashboard
        </button>
        <p className="text-gray-500 text-sm">This availability collection is closed.</p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      <button
        onClick={() => navigate('/')}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4"
      >
        <ArrowLeft size={14} /> Back to Dashboard
      </button>

      <div className="flex items-start gap-4 mb-6">
        <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
          <CalendarDays size={22} className="text-blue-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            {existingResponse ? 'Update My Availability' : 'Submit My Availability'}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">{league.name}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 sm:p-6">
        <CoachAvailabilityForm
          leagueId={leagueId!}
          collectionId={collectionId!}
          dueDate={collection.dueDate}
          coachUid={profile.uid}
          coachName={profile.displayName}
          teamId={coachTeam.id}
          existingResponse={existingResponse}
          onSuccess={() => navigate('/')}
        />
      </div>
    </div>
  );
}
