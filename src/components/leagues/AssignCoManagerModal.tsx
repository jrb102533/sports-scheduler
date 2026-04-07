import { useState, useEffect } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

interface AssignCoManagerModalProps {
  open: boolean;
  onClose: () => void;
  leagueId: string;
  leagueName: string;
}

interface AssignScopedRoleResult {
  success: boolean;
  targetUid: string;
  displayName: string;
}

export function AssignCoManagerModal({ open, onClose, leagueId, leagueName }: AssignCoManagerModalProps) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (!open) {
      setEmail('');
      setError('');
      setSuccess('');
    }
  }, [open]);

  function handleClose() {
    setEmail('');
    setError('');
    setSuccess('');
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');

    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      setError('Email is required.');
      return;
    }

    setLoading(true);
    try {
      const fn = httpsCallable<
        { email: string; role: 'league_manager'; leagueId: string },
        AssignScopedRoleResult
      >(functions, 'assignScopedRole');
      const result = await fn({ email: trimmed, role: 'league_manager', leagueId });
      setSuccess(`${result.data.displayName} has been added as a co-manager of ${leagueName}.`);
      setEmail('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to assign co-manager.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Add Co-Manager" size="sm">
      {success ? (
        <div className="space-y-4">
          <div role="status" className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
            {success}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setSuccess('')}>Add Another</Button>
            <Button onClick={handleClose}>Done</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-gray-600">
            Enter the email address of the person you'd like to add as a co-manager of{' '}
            <strong>{leagueName}</strong>. They must already have a First Whistle account.
          </p>
          <Input
            label="Email address"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="manager@example.com"
            error={error}
            autoFocus
          />
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={handleClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Adding…' : 'Add Co-Manager'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
