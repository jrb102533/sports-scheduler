/**
 * UpgradeToProPage — /upgrade
 *
 * Presents the League Manager Pro upgrade flow with two plan cards
 * (monthly and annual). On CTA click, writes to
 * `customers/{uid}/checkout_sessions` via the Stripe extension and
 * redirects to Stripe Checkout when the `url` field appears.
 *
 * FW-58 locked decisions reflected here:
 *   - 14-day free trial before first charge
 *   - Cancel = lose access at period end (no refunds)
 *   - USD only
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Zap, Calendar, ArrowLeft, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useStripeProducts } from '@/hooks/useStripeProducts';
import { useStripeCheckout } from '@/hooks/useStripeCheckout';
import type { StripePrice } from '@/hooks/useStripeCheckout';

const PRO_FEATURES = [
  'Unlimited leagues and seasons',
  'Schedule wizard with conflict detection',
  'Standings, results tracking & statistics',
  'Coach availability coordination',
  'Automated game notifications',
  'Priority support',
];

function formatUSD(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

interface PlanCardProps {
  interval: 'month' | 'year';
  price: StripePrice;
  isHighlighted?: boolean;
  onSelect: (priceId: string) => void;
  loading: boolean;
}

function PlanCard({ interval, price, isHighlighted, onSelect, loading }: PlanCardProps) {
  const isAnnual = interval === 'year';
  const monthlyEquivalent = isAnnual ? price.unit_amount / 12 : price.unit_amount;

  return (
    <div
      className={`relative flex flex-col rounded-2xl border-2 p-6 transition-shadow ${
        isHighlighted
          ? 'border-[#1B3A6B] shadow-lg ring-1 ring-[#1B3A6B]'
          : 'border-gray-200 shadow-sm'
      }`}
    >
      {isHighlighted && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="inline-flex items-center gap-1 rounded-full bg-[#f97316] px-3 py-1 text-xs font-semibold text-white">
            <Zap size={11} /> Best value — save 17%
          </span>
        </div>
      )}

      <div className="mb-4">
        <div className="flex items-center gap-2 mb-1">
          <Calendar size={16} className="text-gray-500" />
          <span className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
            {isAnnual ? 'Annual' : 'Monthly'}
          </span>
        </div>
        <div className="flex items-baseline gap-1 mt-2">
          <span className="text-4xl font-bold text-gray-900">{formatUSD(monthlyEquivalent)}</span>
          <span className="text-gray-500 text-sm">/mo</span>
        </div>
        {isAnnual && (
          <p className="mt-1 text-sm text-gray-500">
            Billed {formatUSD(price.unit_amount)}/year
          </p>
        )}
      </div>

      <Button
        variant={isHighlighted ? 'primary' : 'secondary'}
        size="lg"
        className="w-full mb-5"
        disabled={loading}
        onClick={() => onSelect(price.id)}
        aria-label={`Start 14-day free trial — ${isAnnual ? 'annual' : 'monthly'} plan`}
      >
        {loading ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            Redirecting…
          </>
        ) : (
          'Start 14-day free trial'
        )}
      </Button>

      <ul className="space-y-2.5 mt-auto">
        {PRO_FEATURES.map((feature) => (
          <li key={feature} className="flex items-start gap-2.5 text-sm text-gray-700">
            <Check size={15} className="text-emerald-500 flex-shrink-0 mt-0.5" />
            {feature}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function UpgradeToProPage() {
  const navigate = useNavigate();
  const { monthlyPrice, annualPrice, loading: productsLoading, error: productsError } = useStripeProducts();
  const { loading: checkoutLoading, error: checkoutError, startCheckout } = useStripeCheckout();
  const [selectedPriceId, setSelectedPriceId] = useState<string | null>(null);

  async function handleSelect(priceId: string) {
    setSelectedPriceId(priceId);
    await startCheckout(priceId);
    // On error, startCheckout sets its own error state; loading stays true only
    // while the redirect is pending, so we only need to clear selectedPriceId on error.
    setSelectedPriceId(null);
  }

  const displayError = checkoutError ?? productsError;

  return (
    <div className="min-h-full bg-gray-50 p-4 sm:p-6">
      <div className="max-w-2xl mx-auto">
        {/* Back nav */}
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors mb-6"
        >
          <ArrowLeft size={15} />
          Back
        </button>

        {/* Hero */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-indigo-50 text-indigo-700 rounded-full px-3 py-1 text-xs font-semibold mb-4">
            <Zap size={12} />
            League Manager Pro
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-3">
            Unlock League Manager Pro
          </h1>
          <p className="text-gray-600 text-base max-w-md mx-auto">
            Everything you need to run a professional youth sports league —
            scheduling, standings, communications, and more.
          </p>
        </div>

        {/* Error state */}
        {displayError && (
          <Card className="p-4 mb-6 border-red-200 bg-red-50">
            <p className="text-sm text-red-700">{displayError}</p>
          </Card>
        )}

        {/* Plan cards */}
        {productsLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-6">
            {[1, 2].map(i => (
              <div key={i} className="h-80 bg-gray-100 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-6">
            {monthlyPrice && (
              <PlanCard
                interval="month"
                price={monthlyPrice}
                onSelect={handleSelect}
                loading={checkoutLoading && selectedPriceId === monthlyPrice.id}
              />
            )}
            {annualPrice && (
              <PlanCard
                interval="year"
                price={annualPrice}
                isHighlighted
                onSelect={handleSelect}
                loading={checkoutLoading && selectedPriceId === annualPrice.id}
              />
            )}
          </div>
        )}

        {/* Fine print */}
        <p className="text-center text-xs text-gray-400 leading-relaxed">
          14-day free trial — no charge until the trial ends. After the trial,
          you'll be billed at the selected plan rate. Cancel anytime — you keep
          access until the end of your current billing period. No refunds.
          Prices in USD.
        </p>
      </div>
    </div>
  );
}
