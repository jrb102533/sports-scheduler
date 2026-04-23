import { useEffect, useState } from 'react';
import { Baby, Info, Mail, ShieldCheck } from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Card } from '@/components/ui/Card';
import { SettingsToggle } from '@/components/settings/SettingsToggle';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useAuthStore } from '@/store/useAuthStore';
import { getUserConsents } from '@/lib/consent';
import { FLAGS } from '@/lib/flags';
import { buildInfo } from '@/lib/buildInfo';
import type { ConsentRecord } from '@/lib/consent';

export function SettingsPage() {
  const { settings, updateSettings } = useSettingsStore();
  const user = useAuthStore(s => s.user);
  const profile = useAuthStore(s => s.profile);
  const [consents, setConsents] = useState<Record<string, ConsentRecord | null> | null>(null);

  // Both notification prefs default to true when the field is absent
  const weeklyDigestEnabled = profile?.weeklyDigestEnabled !== false;
  const messagingNotificationsEnabled = profile?.messagingNotificationsEnabled !== false;

  async function handleWeeklyDigestToggle(value: boolean) {
    if (!user) return;
    await updateDoc(doc(db, 'users', user.uid), { weeklyDigestEnabled: value });
  }

  async function handleMessagingNotifToggle(value: boolean) {
    if (!user) return;
    await updateDoc(doc(db, 'users', user.uid), { messagingNotificationsEnabled: value });
  }

  useEffect(() => {
    if (!user) return;
    getUserConsents(user.uid)
      .then(c => setConsents(c))
      .catch(() => setConsents(null));
  }, [user]);

  return (
    <div className="p-6 max-w-2xl">
      <div className="space-y-6">
        {/* Kids Sports Mode — hidden behind feature flag */}
        {FLAGS.KIDS_MODE && (
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
        )}

        {/* Email Notifications */}
        <Card className="overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
            <Mail size={18} className="text-blue-500" />
            <h2 className="font-semibold text-gray-900">Email Notifications</h2>
          </div>
          <div className="px-5 divide-y divide-gray-100">
            <SettingsToggle
              checked={messagingNotificationsEnabled}
              onChange={handleMessagingNotifToggle}
              label="Chat & message emails"
              description="Get an email when someone sends you a team chat or direct message."
            />
            <SettingsToggle
              checked={weeklyDigestEnabled}
              onChange={handleWeeklyDigestToggle}
              label="Weekly team digest"
              description="Get a Monday morning summary of upcoming events for your team."
            />
          </div>
        </Card>

        {/* Privacy & Legal */}
        <Card className="overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
            <ShieldCheck size={18} className="text-purple-500" />
            <h2 className="font-semibold text-gray-900">Privacy &amp; Legal</h2>
          </div>
          <div className="px-5 py-5 space-y-5 text-sm text-gray-700">
            {/* Document links */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Legal Documents</p>
              <div className="flex flex-col gap-1.5">
                <a
                  href="/legal/privacy-policy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  Privacy Policy
                </a>
                <a
                  href="/legal/terms-of-service"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  Terms of Service
                </a>
              </div>
            </div>

            {/* Consent history */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Your Consents</p>
              {consents === null ? (
                <p className="text-gray-400 text-xs">Loading…</p>
              ) : (
                <div className="space-y-2">
                  {(
                    [
                      { key: 'termsOfService', label: 'Terms of Service' },
                      { key: 'privacyPolicy', label: 'Privacy Policy' },
                      { key: 'marketingEmail', label: 'Marketing emails' },
                    ] as const
                  ).map(({ key, label }) => {
                    const record = consents[key];
                    return (
                      <div key={key} className="flex items-start justify-between gap-4">
                        <span className="text-gray-700">{label}</span>
                        {record ? (
                          <span className="text-xs text-gray-500 text-right shrink-0">
                            v{record.version} &mdash; agreed{' '}
                            {new Date(record.agreedAt).toLocaleDateString(undefined, {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                            })}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400 italic">Not on record</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Data deletion */}
            <div className="space-y-1.5 border-t border-gray-100 pt-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Data Deletion</p>
              <p className="text-xs text-gray-500 leading-relaxed">
                To request deletion of your account and associated data, contact our privacy team. We will respond within 30 days.
              </p>
              <a
                href="mailto:first.whistle.legal@gmail.com?subject=Data%20Deletion%20Request"
                className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline font-medium"
              >
                Request data deletion
              </a>
            </div>
          </div>
        </Card>

        {/* About */}
        <Card className="overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
            <Info size={18} className="text-blue-500" />
            <h2 className="font-semibold text-gray-900">About</h2>
          </div>
          <div className="px-5 py-4 space-y-3">
            {buildInfo.isProduction ? (
              /* Production: version + build + release date + support */
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Version</span>
                  <span className="text-sm font-mono font-medium text-gray-900">{buildInfo.version}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Build</span>
                  <span className="text-sm font-mono text-gray-900">{buildInfo.shortSha}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Released</span>
                  <span className="text-sm text-gray-900">{buildInfo.releaseDate}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Support</span>
                  <a
                    href="mailto:support@firstwhistlesports.com"
                    className="text-sm text-blue-600 hover:underline"
                  >
                    support@firstwhistlesports.com
                  </a>
                </div>
              </>
            ) : (
              /* Non-production: full build info */
              <>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wide ${
                    buildInfo.env === 'staging'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-purple-100 text-purple-800'
                  }`}>
                    {buildInfo.env}
                  </span>
                  <span className="text-xs text-gray-400">First Whistle</span>
                </div>
                <div className="space-y-2 text-sm">
                  {buildInfo.version !== 'dev' && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Version</span>
                      <span className="font-mono text-gray-900">{buildInfo.version}</span>
                    </div>
                  )}
                  {buildInfo.pr && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Pull Request</span>
                      <a
                        href={`https://github.com/jrb102533/sports-scheduler/pull/${buildInfo.pr}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-blue-600 hover:underline"
                      >
                        #{buildInfo.pr}
                      </a>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Branch</span>
                    <span className="font-mono text-gray-700 text-xs truncate max-w-[200px]">{buildInfo.branch}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Commit</span>
                    <a
                      href={`https://github.com/jrb102533/sports-scheduler/commit/${buildInfo.sha}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-blue-600 hover:underline text-xs"
                    >
                      {buildInfo.shortSha}
                    </a>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Built</span>
                    <span className="text-gray-700 text-xs">{buildInfo.buildTimestamp}</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
