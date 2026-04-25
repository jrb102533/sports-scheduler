/**
 * SubscriptionBanner
 *
 * Shown on the dashboard for league_manager users who don't have an
 * active paid subscription. Two states:
 *
 *   - trialing: "You're on a free trial — N days remaining"
 *   - free (no active sub): "Upgrade to League Manager Pro"
 *
 * Returns null for active/admin-granted Pro subscribers and
 * for all non-league-manager roles.
 */

import { useNavigate } from 'react-router-dom';
import { Zap, Clock } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useAuthStore, hasRole } from '@/store/useAuthStore';

function daysRemaining(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

export function SubscriptionBanner() {
  const navigate = useNavigate();
  const profile = useAuthStore(s => s.profile);

  if (!profile) return null;

  // Only relevant for league managers
  if (!hasRole(profile, 'league_manager')) return null;

  // Admin-granted Pro — no banner needed
  if (profile.adminGrantedLM === true) return null;

  const status = profile.subscriptionStatus;
  const tier = profile.subscriptionTier ?? 'free';
  const expiresAt = profile.subscriptionExpiresAt;

  // Active Pro subscriber — no banner
  if (tier === 'league_manager_pro' && (status === 'active' || status === 'trialing')) {
    // Show trial banner even for active Pro trial
    if (status !== 'trialing') return null;
  }

  // Trialing state
  if (status === 'trialing') {
    const days = expiresAt ? daysRemaining(expiresAt) : null;
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
          <Clock size={16} className="text-blue-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-blue-900">
            You're on a free trial
            {days !== null && (
              <span className="font-semibold">
                {' '}— {days} day{days !== 1 ? 's' : ''} remaining
              </span>
            )}
          </p>
          <p className="text-xs text-blue-600 mt-0.5">
            Your card will be charged when the trial ends.
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => navigate('/account/subscription')}
          className="flex-shrink-0"
        >
          View plan
        </Button>
      </div>
    );
  }

  // Free tier or expired / canceled — show upgrade CTA
  if (tier === 'free' || status === 'canceled' || status === 'incomplete_expired') {
    return (
      <div
        className="rounded-xl px-4 py-3 flex items-center gap-3"
        style={{ background: 'linear-gradient(135deg, #1B3A6B 0%, #312e81 100%)' }}
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(255,255,255,0.15)' }}
        >
          <Zap size={16} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">Upgrade to League Manager Pro</p>
          <p className="text-xs text-blue-200 mt-0.5">
            Unlock the full scheduling suite — 14-day free trial.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => navigate('/upgrade')}
          className="flex-shrink-0 bg-[#f97316] hover:bg-orange-500 text-white border-0 focus:ring-orange-400"
        >
          Upgrade
        </Button>
      </div>
    );
  }

  return null;
}
