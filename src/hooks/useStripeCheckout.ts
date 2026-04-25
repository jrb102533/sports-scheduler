/**
 * useStripeCheckout
 *
 * Handles the full Stripe Checkout session flow via the
 * invertase/firestore-stripe-payments extension:
 *
 *   1. Reads price IDs from `products/{prodId}/prices` (or a passed priceId directly)
 *   2. Writes a checkout_session doc to `customers/{uid}/checkout_sessions`
 *   3. Polls the doc with onSnapshot until the extension writes back a `url`
 *   4. Redirects window.location to that URL
 *
 * The caller is responsible for supplying the resolved Stripe price ID.
 */

import { useState, useCallback } from 'react';
import {
  collection,
  addDoc,
  onSnapshot,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuthStore } from '@/store/useAuthStore';

export type CheckoutInterval = 'month' | 'year';

export interface StripePrice {
  id: string;
  interval: CheckoutInterval;
  unit_amount: number;
  currency: string;
  trial_period_days?: number;
}

interface UseStripeCheckoutResult {
  loading: boolean;
  error: string | null;
  startCheckout: (priceId: string) => Promise<void>;
  /** Load prices for a given Stripe product (doc ID in Firestore `products` collection). */
  loadPrices: (productId: string) => Promise<StripePrice[]>;
}

export function useStripeCheckout(): UseStripeCheckoutResult {
  const uid = useAuthStore(s => s.user?.uid);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPrices = useCallback(async (productId: string): Promise<StripePrice[]> => {
    const pricesRef = collection(db, 'products', productId, 'prices');
    const snap = await getDocs(query(pricesRef, where('active', '==', true)));
    return snap.docs.map(d => ({
      id: d.id,
      ...(d.data() as Omit<StripePrice, 'id'>),
    }));
  }, []);

  const startCheckout = useCallback(async (priceId: string): Promise<void> => {
    if (!uid) {
      setError('You must be signed in to start a checkout session.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const successUrl = `${window.location.origin}/account/subscription?checkout=success`;
      const cancelUrl = `${window.location.origin}/upgrade?checkout=cancelled`;

      const sessionsRef = collection(db, 'customers', uid, 'checkout_sessions');
      const sessionDoc = await addDoc(sessionsRef, {
        price: priceId,
        success_url: successUrl,
        cancel_url: cancelUrl,
        allow_promotion_codes: true,
      });

      // The extension writes the `url` field back asynchronously.
      // Poll with onSnapshot and redirect when it appears.
      // Use a ref object so callbacks that fire synchronously (e.g. in tests)
      // can call the unsubscribe before onSnapshot returns its value.
      await new Promise<void>((resolve, reject) => {
        const unsubRef = { current: () => {} };
        unsubRef.current = onSnapshot(
          sessionDoc,
          (snap) => {
            const data = snap.data();
            if (data?.error) {
              unsubRef.current();
              reject(new Error((data.error as { message?: string }).message ?? 'Checkout session error'));
            } else if (data?.url) {
              unsubRef.current();
              const url = String(data.url);
              // SEC-93: only allow Stripe-hosted redirect URLs.
              if (!/^https:\/\/(checkout|billing)\.stripe\.com\//.test(url)) {
                reject(new Error('Invalid checkout redirect URL.'));
                return;
              }
              window.location.assign(url);
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
      console.error('[useStripeCheckout] checkout failed:', err);
      setError('Failed to start checkout. Please try again.');
      setLoading(false);
    }
    // Don't clear loading on success — page is navigating away.
  }, [uid]);

  return { loading, error, startCheckout, loadPrices };
}
