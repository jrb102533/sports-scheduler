import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, MapPin, ToggleLeft, ToggleRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { VenueFormModal } from './VenueFormModal';
import { useVenueStore } from '@/store/useVenueStore';
import { useAuthStore } from '@/store/useAuthStore';
import type { Venue } from '@/types';

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface Props {
  leagueId: string;
}

export function VenuesPanel({ leagueId }: Props) {
  const { venues, loading, subscribe, addVenue, updateVenue, deleteVenue } = useVenueStore();
  const profile = useAuthStore(s => s.profile);
  const uid = useAuthStore(s => s.user?.uid) ?? '';

  const [formOpen, setFormOpen] = useState(false);
  const [editVenue, setEditVenue] = useState<Venue | undefined>();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribe(leagueId);
    return unsub;
  }, [leagueId, subscribe]);

  const leagueVenues = venues.filter(v => v.leagueId === leagueId);

  async function handleSave(venue: Venue) {
    if (editVenue) {
      await updateVenue(venue);
    } else {
      await addVenue(venue);
    }
  }

  async function handleToggleActive(venue: Venue) {
    await updateVenue({ ...venue, isActive: !venue.isActive, updatedAt: new Date().toISOString() });
  }

  const confirmDeleteVenue = leagueVenues.find(v => v.id === confirmDeleteId);

  const canManage = profile?.role === 'admin' || profile?.role === 'league_manager';

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-gray-500">{leagueVenues.length} venue{leagueVenues.length !== 1 ? 's' : ''}</p>
        {canManage && (
          <Button size="sm" onClick={() => { setEditVenue(undefined); setFormOpen(true); }}>
            <Plus size={14} /> Add Venue
          </Button>
        )}
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-sm text-gray-400">Loading…</div>
      ) : leagueVenues.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-400">
          No venues added yet. Add a venue to start building your schedule.
        </div>
      ) : (
        <div className="space-y-2">
          {leagueVenues.map(venue => (
            <div key={venue.id} className={`bg-white rounded-xl border p-4 ${venue.isActive ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
                  <MapPin size={15} className="text-indigo-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-gray-900">{venue.name}</p>
                    {!venue.isActive && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Inactive</span>
                    )}
                    <span className="text-xs text-gray-400">{venue.capacity} field{venue.capacity !== 1 ? 's' : ''}</span>
                  </div>
                  {venue.address && <p className="text-xs text-gray-500 mt-0.5">{venue.address}</p>}
                  <div className="flex flex-wrap gap-1 mt-2">
                    {venue.availabilitySlots.map((slot, i) => (
                      <span key={i} className="text-xs bg-blue-50 text-blue-700 border border-blue-100 rounded px-2 py-0.5">
                        {DAY_SHORT[slot.dayOfWeek]} {slot.startTime}–{slot.endTime}
                      </span>
                    ))}
                  </div>
                </div>
                {canManage && (
                  <div className="flex gap-1 flex-shrink-0">
                    <button
                      onClick={() => void handleToggleActive(venue)}
                      className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
                      title={venue.isActive ? 'Deactivate' : 'Activate'}
                    >
                      {venue.isActive ? <ToggleRight size={16} className="text-green-600" /> : <ToggleLeft size={16} />}
                    </button>
                    <button
                      onClick={() => { setEditVenue(venue); setFormOpen(true); }}
                      className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(venue.id)}
                      className="p-2 rounded-lg hover:bg-red-50 text-red-500 transition-colors"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <VenueFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        leagueId={leagueId}
        createdBy={uid}
        editVenue={editVenue}
        onSave={handleSave}
      />

      <ConfirmDialog
        open={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={async () => {
          if (confirmDeleteId) await deleteVenue(confirmDeleteId);
          setConfirmDeleteId(null);
        }}
        title="Delete Venue"
        message={`Delete "${confirmDeleteVenue?.name}"? This cannot be undone.`}
      />
    </div>
  );
}
