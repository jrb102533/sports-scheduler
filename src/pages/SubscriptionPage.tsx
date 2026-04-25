/**
 * SubscriptionPage — /account/subscription
 *
 * Shows current plan status for active subscribers and provides a
 * "Manage subscription" button that redirects to the Stripe Customer Portal.
 *
 * The Stripe Customer Portal is accessed via the invertase extension's
 * portal_links pattern: write to `customers/{uid}/portal_links`, then
 * onSnapshot until the extension writes back a `url` field.
 *
 * Users without an active subscription are redirected to /upgrade.
 */

import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { collection, addDoc, onSnapshot } from 'firebase/firestore';
import { CreditCard, CheckCircle2, AlertTriangle, Clock, XCircle, Loader2, ExternalLink } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useAuthStore } from '@/store/useAuthStore';
import { db } from '@/lib/firebase';
import type { SubscriptionStatus } from '@/types';

type BadgeVariant = 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info';

const STATUS_CONFIG: Record<SubscriptionStatus, {
  label: string;
  variant: BadgeVariant;
  icon: React.ReactNode;
  description: string;
}> = {
  active: {
    label: 'Active',
    variant: 'success',
    icon: <CheckCircle2 size={14} />,
    description: 'Your subscription is active.',
  },
  trialing: {
    label: 'Free trial',
    variant: 'info',
    icon: <Clock size={14} />,
    description: 'You\'re on your 14-day free trial. Your card won\'t be charged until it ends.',
  },
  past_due: {
    label: 'Past due',
    variant: 'warning',
    icon: <AlertTriangle size={14} />,
    description: 'Payment failed. Update your payment method to keep access. You have a 7-day grace period.',
  },
  canceled: {
    label: 'Canceled',
    variant: 'default',
    icon: <XCircle size={14} />,
    description: 'Your subscription has been canceled. Access continues until the period end.',
  },
  incomplete: {
    label: 'Incomplete',
    variant: 'warning',
    icon: <AlertTriangle size={14} />,
    description: 'Payment is incomplete. Please complete your payment to activate your subscription.',
  },
  incomplete_expired: {
    label: 'Expired',
    variant: 'error',
    icon: <XCircle size={14} />,
    description: 'Your payment window expired. Please start a new subscription.',
  },
  unpaid: {
    label: 'Unpaid',
    variant: 'error',
    icon: <AlertTriangle size={14} />,
    description: 'Invoice is unpaid. Update your payment method to restore access.',
  },
};

function formatExpiresAt(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function daysRemaining(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

export function SubscriptionPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const profile = useAuthStore(s => s.profile);
  const uid = useAuthStore(s => s.user?.uid);

  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  const checkoutSuccess = searchParams.get('checkout') === 'success';

  // Redirect free-tier users to the upgrade page
  useEffect(() => {
    if (!profile) return;
    const isProOrTrialing =
      profile.subscriptionTier === 'league_manager_pro' ||
      profile.subscriptionStatus === 'trialing' ||
      profile.adminGrantedLM === true;
    if (!isProOrTrialing) {
      navigate('/upgrade', { replace: true });
    }
  }, [profile, navigate]);

  async function handleManageSubscription() {
    if (!uid) return;

    setPortalLoading(true);
    setPortalError(null);

    try {
      const portalRef = collection(db, 'customers', uid, 'portal_links');
      const linkDoc = await addDoc(portalRef, {
        return_url: `${window.location.origin}/account/subscription`,
      });

      await new Promise<void>((resolve, reject) => {
        // Wrap the unsubscribe in a ref object so callbacks that fire
        // synchronously (e.g. mock implementations) can call it safely even
        // before the outer `onSnapshot` call returns.
        const unsubRef = { current: () => {} };
        unsubRef.current = onSnapshot(
          linkDoc,
          (snap) => {
            const data = snap.data();
            if (data?.error) {
              unsubRef.current();
              reject(new Error((data.error as { message?: string }).message ?? 'Portal error'));
            } else if (data?.url) {
              unsubRef.current();
              window.location.assign(data.url as string);
              resolve();
            }
          },
          (err) => {
            unsubRef.current();
            reject(err);
          }
        );
      });
    } catch (err) {
      console.error('[SubscriptionPage] portal link failed:', err);
      setPortalError('Failed to open the billing portal. Please try again.');
      setPortalLoading(false);
    }
  }

  if (!profile) {
    return (
      <div className="p-6">
        <div className="h-48 bg-gray-100 rounded-xl animate-pulse" />
      </div>
    );
  }

  const status = profile.subscriptionStatus ?? null;
  const expiresAt = profile.subscriptionExpiresAt ?? null;
  const isAdminGranted = profile.adminGrantedLM === true;
  const statusConfig = status ? STATUS_CONFIG[status] : null;

  const isTrialing = status === 'trialing';
  const trialDaysLeft = isTrialing && expiresAt ? daysRemaining(expiresAt) : null;

  return (
    <div className="p-4 sm:p-6 max-w-xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Subscription</h1>
        <p className="text-sm text-gray-500 mt-0.5">League Manager Pro</p>
      </div>

      {/* Checkout success banner */}
      {checkoutSuccess && (
        <Card className="p-4 border-emerald-200 bg-emerald-50">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0" />
            <p className="text-sm text-emerald-700 font-medium">
              You're all set! Your League Manager Pro trial has started.
            </p>
          </div>
        </Card>
      )}

      {/* Plan overview card */}
      <Card className="p-5">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
            <CreditCard size={20} className="text-indigo-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-gray-900">League Manager Pro</p>
              {isAdminGranted ? (
                <Badge variant="info">Admin granted</Badge>
              ) : statusConfig ? (
                <Badge variant={statusConfig.variant}>
                  <span className="flex items-center gap-1">
                    {statusConfig.icon}
                    {statusConfig.label}
                  </span>
                </Badge>
              ) : null}
            </div>

            {statusConfig && (
              <p className="text-sm text-gray-500 mt-1">{statusConfig.description}</p>
            )}

            {isAdminGranted && (
              <p className="text-sm text-gray-500 mt-1">
                Pro access has been granted by the platform administrator.
              </p>
            )}
          </div>
        </div>

        {/* Trial days remaining */}
        {isTrialing && trialDaysLeft !== null && (
          <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 mb-4">
            <p className="text-sm text-blue-700">
              <span className="font-semibold">{trialDaysLeft} day{trialDaysLeft !== 1 ? 's' : ''}</span> remaining in your free trial.
            </p>
          </div>
        )}

        {/* Period end date */}
        {expiresAt && !isTrialing && (
          <div className="text-sm text-gray-600 mb-4">
            {status === 'canceled'
              ? `Access until: ${formatExpiresAt(expiresAt)}`
              : `Next billing date: ${formatExpiresAt(expiresAt)}`}
          </div>
        )}

        {/* Portal error */}
        {portalError && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">
            <p className="text-sm text-red-700">{portalError}</p>
          </div>
        )}

        {/* Manage button — not shown for admin-granted access */}
        {!isAdminGranted && (
          <Button
            variant="secondary"
            onClick={() => void handleManageSubscription()}
            disabled={portalLoading}
            className="w-full sm:w-auto"
          >
            {portalLoading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Opening portal…
              </>
            ) : (
              <>
                <ExternalLink size={14} />
                {status === 'past_due' ? 'Update payment method' : 'Manage subscription'}
              </>
            )}
          </Button>
        )}
      </Card>

      {/* Re-subscribe CTA for canceled users */}
      {status === 'canceled' && (
        <Card className="p-4 border-dashed border-2 border-gray-200">
          <p className="text-sm text-gray-600 mb-3">
            Ready to resubscribe? Start a new plan whenever you're ready.
          </p>
          <Button size="sm" onClick={() => navigate('/upgrade')}>
            View plans
          </Button>
        </Card>
      )}

      {/* Fine print */}
      <p className="text-xs text-gray-400 leading-relaxed text-center">
        Billing is managed by Stripe. Cancel anytime via the Manage subscription button —
        you keep access until the end of your current billing period. No refunds.
      </p>
    </div>
  );
}
