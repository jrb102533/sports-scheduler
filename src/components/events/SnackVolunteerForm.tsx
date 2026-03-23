import { useState } from 'react';
import { Cookie, Plus, Trash2, UserCheck } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useEventStore } from '@/store/useEventStore';
import { useAuthStore } from '@/store/useAuthStore';
import type { ScheduledEvent, SnackSignup } from '@/types';

interface SnackVolunteerFormProps {
  event: ScheduledEvent;
}

export function SnackVolunteerForm({ event }: SnackVolunteerFormProps) {
  const { updateEvent } = useEventStore();
  const profile = useAuthStore(s => s.profile);

  const [signupOpen, setSignupOpen] = useState(false);
  const [name, setName] = useState(profile?.displayName ?? '');
  const [bringing, setBringing] = useState(event.snackItem ?? '');
  const [error, setError] = useState('');

  const signups: SnackSignup[] = event.snackSignups ?? [];
  const canManage = profile?.role === 'admin' || profile?.role === 'league_manager' || profile?.role === 'coach';

  function handleSignup() {
    if (!name.trim()) { setError('Your name is required'); return; }
    if (!bringing.trim()) { setError('Please enter what you\'re bringing'); return; }
    const newSignup: SnackSignup = {
      id: crypto.randomUUID(),
      name: name.trim(),
      bringing: bringing.trim(),
      signedUpAt: new Date().toISOString(),
    };
    const updated = [...signups, newSignup];
    updateEvent({ ...event, snackSignups: updated, updatedAt: new Date().toISOString() });
    setSignupOpen(false);
    setName(profile?.displayName ?? '');
    setBringing(event.snackItem ?? '');
    setError('');
  }

  function handleRemove(id: string) {
    const updated = signups.filter(s => s.id !== id);
    updateEvent({ ...event, snackSignups: updated, updatedAt: new Date().toISOString() });
  }

  // Don't render if no snack item set and not a manager (nothing to show players)
  if (!event.snackItem && !canManage && signups.length === 0) return null;

  return (
    <div className="border border-orange-200 bg-orange-50 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-orange-800 flex items-center gap-2">
          <Cookie size={14} /> Snack Volunteer
        </h3>
        {!signupOpen && (
          <button
            onClick={() => setSignupOpen(true)}
            className="flex items-center gap-1 text-xs font-medium text-orange-700 hover:text-orange-900 transition-colors"
          >
            <Plus size={13} /> Sign up
          </button>
        )}
      </div>

      {/* Requested item */}
      {event.snackItem && (
        <p className="text-sm text-orange-700">
          <span className="font-medium">Requested:</span> {event.snackItem}
        </p>
      )}

      {/* Existing signups */}
      {signups.length > 0 && (
        <div className="space-y-1.5">
          {signups.map(s => (
            <div key={s.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 text-sm">
              <div className="flex items-center gap-2 min-w-0">
                <UserCheck size={13} className="text-orange-500 flex-shrink-0" />
                <span className="font-medium text-gray-800 truncate">{s.name}</span>
                {s.bringing && <span className="text-gray-500 truncate">— {s.bringing}</span>}
              </div>
              {canManage && (
                <button onClick={() => handleRemove(s.id)} className="ml-2 text-gray-300 hover:text-red-400 flex-shrink-0">
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {signups.length === 0 && !signupOpen && (
        <p className="text-xs text-orange-600 italic">No one has signed up yet. Be the first!</p>
      )}

      {/* Sign up form */}
      {signupOpen && (
        <div className="bg-white rounded-lg p-3 space-y-2 border border-orange-200">
          <Input
            placeholder="Your name"
            value={name}
            onChange={e => { setName(e.target.value); setError(''); }}
          />
          <Input
            placeholder={event.snackItem ? `e.g. ${event.snackItem}` : "What you're bringing"}
            value={bringing}
            onChange={e => { setBringing(e.target.value); setError(''); }}
          />
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSignup}>Sign Up</Button>
            <Button variant="ghost" size="sm" onClick={() => { setSignupOpen(false); setError(''); }}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
