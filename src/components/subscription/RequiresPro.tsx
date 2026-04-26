/**
 * RequiresPro
 *
 * Wrapper component that gates LM action surfaces behind a Pro subscription.
 *
 * Mode A — 'disabled' (default):
 *   Renders children but overlays pointer-events-none + opacity-50 when the
 *   user is not Pro. A small badge anchored to the top-right corner shows
 *   "Upgrade to Pro" (or a custom ctaLabel). Clicking anywhere on the wrapper
 *   navigates to /upgrade.
 *
 * Mode B — 'hidden':
 *   Renders nothing when the user is not Pro. Use this for entire sections
 *   where there is no useful free-tier behaviour.
 *
 * When the user IS Pro, renders children as-is with no wrapper overhead.
 */

import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIsPro } from '@/hooks/useIsPro';

interface Props {
  children: ReactNode;
  mode?: 'disabled' | 'hidden';
  /** Override the upgrade CTA label shown in the badge. */
  ctaLabel?: string;
}

export function RequiresPro({ children, mode = 'disabled', ctaLabel = 'Upgrade to Pro' }: Props) {
  const isPro = useIsPro();
  const navigate = useNavigate();

  // Pro users: render children with no overhead.
  if (isPro) return <>{children}</>;

  // Hidden mode: render nothing for non-Pro users.
  if (mode === 'hidden') return null;

  // Disabled mode: wrap children with an upgrade overlay.
  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    navigate('/upgrade');
  }

  return (
    <span className="relative inline-flex" aria-label={`Pro feature — ${ctaLabel}`}>
      {/* Children with pointer events disabled and reduced opacity */}
      <span
        className="pointer-events-none select-none opacity-50"
        aria-hidden="true"
        tabIndex={-1}
      >
        {children}
      </span>

      {/* Invisible full-coverage click target that navigates to /upgrade */}
      <button
        type="button"
        onClick={handleClick}
        className="absolute inset-0 w-full h-full cursor-pointer rounded focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1"
        aria-label={`Pro feature — ${ctaLabel}`}
      />

      {/* Upgrade badge — top-right corner */}
      <span
        className="absolute -top-2.5 -right-2 z-10 inline-flex items-center gap-0.5 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 whitespace-nowrap pointer-events-none select-none shadow-sm"
        aria-hidden="true"
      >
        <span aria-hidden="true">✦</span>
        {ctaLabel}
      </span>
    </span>
  );
}
