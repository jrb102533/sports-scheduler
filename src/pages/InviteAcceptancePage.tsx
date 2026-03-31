import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Trophy } from 'lucide-react';
import { db } from '@/lib/firebase';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { EmptyState } from '@/components/ui/EmptyState';
import { useAuthStore } from '@/store/useAuthStore';
import type { Team } from '@/types';

interface PendingInvite {
  id: string;
  email: string;
  leagueId: string;
  leagueName: string;
  placeholderTeamId: string;
  invitedBy: string;
  invitedAt: string;
}

interface AcceptLeagueInviteData {
  inviteId: string;
  realTeamId?: string;
}

interface AcceptLeagueInviteResult {
  success: boolean;
}

const acceptLeagueInviteFn = httpsCallable<AcceptLeagueInviteData, AcceptLeagueInviteResult>(
  getFunctions(),
  'acceptLeagueInvite',
);

export function InviteAcceptancePage() {
  const navigate = useNavigate();
  const user = useAuthStore(s => s.user);

  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [ownedTeams, setOwnedTeams] = useState<Team[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Per-invite UI state: selected real team ID and submission status.
  const [selectedTeam, setSelectedTeam] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({});
  const [submitError, setSubmitError] = useState<Record<string, string>>({});
  const [accepted, setAccepted] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user) {
      navigate('/login', { state: { returnTo: '/invite/league' }, replace: true });
      return;
    }

    const email = user.email?.toLowerCase() ?? '';

    async function loadData() {
      setLoadingInvites(true);
      setFetchError(null);
      try {
        // Fetch all pending invites for this user's email.
        const invitesSnap = await getDocs(
          query(
            collection(db, 'invites'),
            where('email', '==', email),
            where('acceptedAt', '==', null),
          ),
        );

        const pendingInvites: PendingInvite[] = invitesSnap.docs.map(d => ({
          id: d.id,
          ...(d.data() as Omit<PendingInvite, 'id'>),
        }));
        setInvites(pendingInvites);

        // Fetch teams owned by this user that are not placeholders.
        const teamsSnap = await getDocs(
          query(
            collection(db, 'teams'),
            where('createdBy', '==', user.uid),
          ),
        );
        const owned: Team[] = teamsSnap.docs
          .map(d => d.data() as Team)
          .filter(t => !t.isPending && !t.isDeleted);
        setOwnedTeams(owned);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setFetchError(`Failed to load invitations: ${msg}`);
      } finally {
        setLoadingInvites(false);
      }
    }

    void loadData();
  }, [user, navigate]);

  async function handleAccept(invite: PendingInvite) {
    const inviteId = invite.id;
    const realTeamId = selectedTeam[inviteId] || undefined;

    setSubmitting(prev => ({ ...prev, [inviteId]: true }));
    setSubmitError(prev => ({ ...prev, [inviteId]: '' }));

    try {
      await acceptLeagueInviteFn({ inviteId, realTeamId });
      setAccepted(prev => new Set(prev).add(inviteId));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      setSubmitError(prev => ({ ...prev, [inviteId]: msg }));
    } finally {
      setSubmitting(prev => ({ ...prev, [inviteId]: false }));
    }
  }

  function handleNavigateLeagues() {
    navigate('/leagues');
  }

  if (loadingInvites) {
    return (
      <div className="p-4 sm:p-6 flex items-center justify-center min-h-[200px]">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500">Loading invitations...</p>
        </div>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="p-4 sm:p-6">
        <p className="text-sm text-red-600">{fetchError}</p>
        <Button className="mt-4" onClick={() => navigate('/')}>Back to Dashboard</Button>
      </div>
    );
  }

  const pendingInvites = invites.filter(inv => !accepted.has(inv.id));
  const acceptedCount = accepted.size;

  if (pendingInvites.length === 0 && acceptedCount === 0) {
    return (
      <div className="p-4 sm:p-6">
        <EmptyState
          icon={<Trophy size={32} className="text-gray-400" />}
          title="No pending invitations"
          description="You have no pending league invitations."
          action={<Button onClick={handleNavigateLeagues}>View Leagues</Button>}
        />
      </div>
    );
  }

  if (pendingInvites.length === 0 && acceptedCount > 0) {
    return (
      <div className="p-4 sm:p-6 max-w-xl mx-auto">
        <div className="text-center py-8">
          <Trophy size={36} className="text-green-600 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-gray-900 mb-1">
            {acceptedCount === 1 ? 'Invitation accepted' : 'Invitations accepted'}
          </h2>
          <p className="text-sm text-gray-500 mb-6">
            You have joined {acceptedCount === 1 ? 'a league' : `${acceptedCount} leagues`} successfully.
          </p>
          <Button onClick={handleNavigateLeagues}>View Leagues</Button>
        </div>
      </div>
    );
  }

  const teamOptions = ownedTeams.map(t => ({ value: t.id, label: t.name }));

  return (
    <div className="p-4 sm:p-6 max-w-xl mx-auto">
      <h1 className="text-xl font-semibold text-gray-900 mb-1">League Invitations</h1>
      <p className="text-sm text-gray-500 mb-6">
        You have {pendingInvites.length} pending league {pendingInvites.length === 1 ? 'invitation' : 'invitations'}.
      </p>

      <div className="flex flex-col gap-4">
        {pendingInvites.map(invite => (
          <Card key={invite.id} className="p-5">
            <div className="mb-4">
              <p className="text-sm text-gray-500 mb-1">You've been invited to join</p>
              <h2 className="text-base font-semibold text-gray-900">{invite.leagueName}</h2>
            </div>

            {teamOptions.length > 0 && (
              <div className="mb-4">
                <Select
                  label="Join with an existing team (optional)"
                  options={teamOptions}
                  placeholder="Use placeholder team"
                  value={selectedTeam[invite.id] ?? ''}
                  onChange={e =>
                    setSelectedTeam(prev => ({ ...prev, [invite.id]: e.target.value }))
                  }
                />
              </div>
            )}

            {submitError[invite.id] && (
              <p className="text-xs text-red-600 mb-3">{submitError[invite.id]}</p>
            )}

            <Button
              onClick={() => handleAccept(invite)}
              disabled={submitting[invite.id]}
              className="w-full"
            >
              {submitting[invite.id]
                ? 'Accepting...'
                : selectedTeam[invite.id]
                  ? 'Join with my existing team'
                  : `Accept as Pending \u2014 ${invite.email}`}
            </Button>
          </Card>
        ))}
      </div>

      {acceptedCount > 0 && (
        <p className="text-sm text-green-600 mt-4 text-center">
          {acceptedCount} invitation{acceptedCount > 1 ? 's' : ''} accepted.
        </p>
      )}

      <div className="mt-6 text-center">
        <button
          onClick={handleNavigateLeagues}
          className="text-sm text-gray-500 hover:text-gray-800 underline"
        >
          View Leagues
        </button>
      </div>
    </div>
  );
}
