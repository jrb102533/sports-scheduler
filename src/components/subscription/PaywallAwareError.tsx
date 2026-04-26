/**
 * PaywallAwareError
 *
 * Renders an error message with paywall-aware messaging. When the underlying
 * error is a Firestore/CF permission denial AND the current user is not
 * Pro-entitled, swaps the generic "permission denied" text for an upgrade
 * CTA pointing at /upgrade.
 *
 * Use anywhere a try/catch surfaces an error string to the user that could
 * have come from a paywall-gated write (rules layer or assertSubscribedOrAdmin
 * in a callable).
 */

import { useNavigate } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useIsPro } from '@/hooks/useIsPro';

interface Props {
  /** The raw error string. Pass `null` / `''` to render nothing. */
  error: string | null | undefined;
  /** Optional verb for the upgrade prompt. Default: "perform this action". */
  action?: string;
  className?: string;
}

const PERMISSION_PATTERNS = [
  /missing or insufficient permissions/i,
  /permission[-_ ]denied/i,
  /league manager pro subscription/i,
];

function isPermissionError(message: string): boolean {
  return PERMISSION_PATTERNS.some(pattern => pattern.test(message));
}

export function PaywallAwareError({ error, action = 'perform this action', className }: Props) {
  const navigate = useNavigate();
  const isPro = useIsPro();

  if (!error) return null;

  const isPaywall = !isPro && isPermissionError(error);

  if (isPaywall) {
    return (
      <div
        className={`flex items-start gap-3 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-3 ${className ?? ''}`}
        role="alert"
      >
        <ShieldAlert className="h-5 w-5 flex-shrink-0 text-indigo-600 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-indigo-900">
            League Manager Pro is required to {action}.
          </p>
          <p className="text-sm text-indigo-800 mt-0.5">
            Start a 14-day free trial to unlock the full toolkit.
          </p>
          <button
            type="button"
            onClick={() => navigate('/upgrade')}
            className="mt-2 inline-flex items-center rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            Upgrade to Pro →
          </button>
        </div>
      </div>
    );
  }

  return (
    <p
      className={`text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 ${className ?? ''}`}
      role="alert"
    >
      {error}
    </p>
  );
}
