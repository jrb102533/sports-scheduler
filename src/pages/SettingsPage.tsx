import { Baby, MessageSquare } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { SettingsToggle } from '@/components/settings/SettingsToggle';
import { useSettingsStore } from '@/store/useSettingsStore';

export function SettingsPage() {
  const { settings, updateSettings } = useSettingsStore();

  return (
    <div className="p-6 max-w-2xl">
      <div className="space-y-6">
        {/* Kids Sports Mode */}
        <Card className="overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
            <Baby size={18} className="text-blue-500" />
            <h2 className="font-semibold text-gray-900">Kids Sports Mode</h2>
          </div>
          <div className="px-5 divide-y divide-gray-100">
            <SettingsToggle
              checked={settings.kidsSportsMode}
              onChange={v => updateSettings({ kidsSportsMode: v })}
              label="Enable Kids Sports Mode"
              description="Shows age groups on teams, uses friendlier language, and simplifies the interface for youth leagues."
            />
            <SettingsToggle
              checked={settings.hideStandingsInKidsMode}
              onChange={v => updateSettings({ hideStandingsInKidsMode: v })}
              label="Hide Standings"
              description="Hides the Standings page when Kids Sports Mode is active. Great for recreational leagues that don't track wins and losses."
            />
          </div>
        </Card>

        {/* Messaging */}
        <Card className="overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
            <MessageSquare size={18} className="text-green-500" />
            <h2 className="font-semibold text-gray-900">SMS Messaging</h2>
          </div>
          <div className="px-5 py-4 text-sm text-gray-600 space-y-2">
            <p>SMS messages are sent using your device's native messaging app. No account or subscription required.</p>
            <p>To enable messaging for players, add parent contact info (name and phone number) when creating or editing a player.</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
