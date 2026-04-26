import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { Trophy } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { PaywallAwareError } from '@/components/subscription/PaywallAwareError';
import { functions } from '@/lib/firebase';
import { SPORT_TYPES, SPORT_TYPE_LABELS } from '@/constants';
import type { SportType } from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface CreateLeagueRequest {
  name: string;
  sportType?: SportType;
  season?: string;
  description?: string;
}

interface CreateLeagueResponse {
  leagueId: string;
  newMembershipIndex: number;
}

const sportOptions = SPORT_TYPES.map(s => ({ value: s, label: SPORT_TYPE_LABELS[s] }));

export function BecomeLeagueManagerModal({ open, onClose }: Props) {
  const navigate = useNavigate();

  const [step, setStep] = useState<'acknowledge' | 'form'>('acknowledge');
  const [name, setName] = useState('');
  const [sportType, setSportType] = useState('');
  const [season, setSeason] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setStep('acknowledge');
      setName('');
      setSportType('');
      setSeason('');
      setDescription('');
      setError(null);
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setSubmitting(true);
    setError(null);

    try {
      const fn = httpsCallable<CreateLeagueRequest, CreateLeagueResponse>(
        functions,
        'createLeagueAndBecomeManager'
      );
      const result = await fn({
        name: name.trim(),
        sportType: (sportType as SportType) || undefined,
        season: season.trim() || undefined,
        description: description.trim() || undefined,
      });

      // activeContext is set server-side in the CF (client write is blocked by Firestore rules post role-elevation)
      navigate(`/leagues/${result.data.leagueId}`);
      onClose();
    } catch (err: unknown) {
      setError((err as Error).message ?? 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (step === 'acknowledge') {
    return (
      <Modal open={open} onClose={onClose} title="League Manager Plan">
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <Trophy size={40} className="text-indigo-500" aria-hidden="true" />
          <p className="text-sm text-gray-600">
            Manage multi-team schedules, standings, and league communications all in one place.
          </p>
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-700">
            Free during beta
          </span>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => setStep('form')}>
            Get Started &rarr;
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title="New League">
      <form onSubmit={handleSubmit} noValidate>
        <div className="flex flex-col gap-4">
          <PaywallAwareError error={error} action="create a league" />


          <Input
            label="League Name"
            value={name}
            onChange={e => setName(e.target.value)}
            required
            autoFocus
          />

          <Select
            label="Sport"
            value={sportType}
            onChange={e => setSportType(e.target.value)}
            options={sportOptions}
            placeholder="Any sport"
          />

          <Input
            label="Season"
            value={season}
            onChange={e => setSeason(e.target.value)}
            placeholder="e.g. Spring 2026"
          />

          <div className="flex flex-col gap-1">
            <label
              htmlFor="league-description"
              className="text-sm font-medium text-gray-700"
            >
              Description
            </label>
            <textarea
              id="league-description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={!name.trim() || submitting}
          >
            {submitting ? 'Creating…' : 'Create League'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
