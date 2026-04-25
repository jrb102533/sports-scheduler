/**
 * useStripeProducts
 *
 * Reads the Stripe product + price catalogue from Firestore.
 * The invertase/firestore-stripe-payments extension mirrors the Stripe
 * product catalogue into the `products` collection.
 *
 * We look for the active product whose metadata.role === 'league_manager_pro'
 * (set in the Stripe dashboard), then load its active prices.
 */

import { useState, useEffect } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { StripePrice } from './useStripeCheckout';

export interface StripeProduct {
  id: string;
  name: string;
  description?: string;
  prices: StripePrice[];
}

interface UseStripeProductsResult {
  product: StripeProduct | null;
  monthlyPrice: StripePrice | null;
  annualPrice: StripePrice | null;
  loading: boolean;
  error: string | null;
}

export function useStripeProducts(): UseStripeProductsResult {
  const [product, setProduct] = useState<StripeProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // Find the active LM Pro product by its metadata role marker
        const productsSnap = await getDocs(
          query(
            collection(db, 'products'),
            where('active', '==', true),
            where('metadata.role', '==', 'league_manager_pro')
          )
        );

        if (productsSnap.empty) {
          if (!cancelled) setError('Subscription product not found. Please contact support.');
          return;
        }

        const productDoc = productsSnap.docs[0];
        const productData = productDoc.data() as { name: string; description?: string };

        // Load all active prices for this product
        const pricesSnap = await getDocs(
          query(
            collection(db, 'products', productDoc.id, 'prices'),
            where('active', '==', true)
          )
        );

        const prices: StripePrice[] = pricesSnap.docs.map(d => ({
          id: d.id,
          ...(d.data() as Omit<StripePrice, 'id'>),
        }));

        if (!cancelled) {
          setProduct({
            id: productDoc.id,
            name: productData.name,
            description: productData.description,
            prices,
          });
        }
      } catch (err) {
        console.error('[useStripeProducts] load failed:', err);
        if (!cancelled) setError('Failed to load subscription plans. Please try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, []);

  const monthlyPrice = product?.prices.find(p => p.interval === 'month') ?? null;
  const annualPrice = product?.prices.find(p => p.interval === 'year') ?? null;

  return { product, monthlyPrice, annualPrice, loading, error };
}
