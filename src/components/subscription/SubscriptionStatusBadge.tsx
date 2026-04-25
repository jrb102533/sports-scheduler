/**
 * SubscriptionStatusBadge
 *
 * A small topbar pill badge indicating Pro subscription state. Renders
 * nothing for free users or states that have no actionable meaning
 * (incomplete, incomplete_expired, unpaid).
 *
 * States shown:
 *   Pro         — active paid or admin-granted (indigo)
 *   Trial·Nd    — trialing with days remaining (blue)
 *   Past due    — past_due (amber)
 *   Pro·Ends Md — canceled but subscriptionExpiresAt is still in the future (purple)
 *
 * Click on any state navigates to /account/subscription.
 */

import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/useAuthStore';

function daysRemaining(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

/**
 * Format an ISO date as a short end-date label for the badge.
 * Same calendar year → "Mar 9"; future year → "Mar 9, 2027".
 */
function formatEndDate(iso: string): string {
  const date = new Date(iso);
  const currentYear = new Date().getFullYear();
  const opts: Intl.DateTimeFormatOptions =
    date.getFullYear() === currentYear
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' };
  return date.toLocaleDateString('en-US', opts);
}

export function SubscriptionStatusBadge() {
  const navigate = useNavigate();
  const profile = useAuthStore(s => s.profile);

  if (!profile) return null;

  const { subscriptionTier, subscriptionStatus, subscriptionExpiresAt, adminGrantedLM } = profile;

  const isAdminGranted = adminGrantedLM === true;
  const isPro = subscriptionTier === 'league_manager_pro' || isAdminGranted;

  // Canceled-but-not-yet-expired: show purple "Pro · Ends Mar 9" pill.
  // This must be checked before the generic free-tier guard so it wins even
  // if subscriptionTier has already been downgraded to 'free' by Stripe sync.
  const isCanceledActive =
    subscriptionStatus === 'canceled' &&
    subscriptionExpiresAt != null &&
    new Date(subscriptionExpiresAt).getTime() > Date.now();

  if (!isPro && !isCanceledActive && subscriptionStatus !== 'trialing' && subscriptionStatus !== 'past_due') {
    return null;
  }

  function handleClick() {
    navigate('/account/subscription');
  }

  // Canceled but paid access still active — purple pill
  if (isCanceledActive && subscriptionExpiresAt) {
    const endLabel = formatEndDate(subscriptionExpiresAt);
    return (
      <button
        onClick={handleClick}
        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-800 hover:bg-purple-200 transition-colors focus:outline-none focus:ring-2 focus:ring-purple-400 focus:ring-offset-1"
        aria-label={`Pro access ends ${endLabel} — click to resubscribe`}
      >
        Pro · Ends {endLabel}
      </button>
    );
  }

  // Past due — amber pill
  if (subscriptionStatus === 'past_due') {
    return (
      <button
        onClick={handleClick}
        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 hover:bg-amber-200 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-1"
        aria-label="Subscription past due — click to manage"
      >
        Past due
      </button>
    );
  }

  // Trialing — blue pill with days left
  if (subscriptionStatus === 'trialing') {
    const days = subscriptionExpiresAt ? daysRemaining(subscriptionExpiresAt) : null;
    return (
      <button
        onClick={handleClick}
        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 hover:bg-blue-200 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-1"
        aria-label={days !== null ? `Free trial — ${days} days remaining` : 'Free trial — click to manage'}
      >
        Trial{days !== null ? ` · ${days}d` : ''}
      </button>
    );
  }

  // Active Pro (including admin-granted) — indigo pill
  if (isPro && (subscriptionStatus === 'active' || isAdminGranted)) {
    return (
      <button
        onClick={handleClick}
        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-800 hover:bg-indigo-200 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-1"
        aria-label="League Manager Pro — click to manage subscription"
      >
        Pro
      </button>
    );
  }

  return null;
}
