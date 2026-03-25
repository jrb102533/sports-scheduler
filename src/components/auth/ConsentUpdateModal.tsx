import { useState } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { recordConsent } from '@/lib/consent';
import { LEGAL_VERSIONS } from '@/legal/versions';

export function ConsentUpdateModal() {
  const user = useAuthStore(s => s.user);
  const markConsentCurrent = useAuthStore(s => s.markConsentCurrent);
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleConfirm() {
    if (!user || !agreed) return;
    setError('');
    setLoading(true);
    try {
      await recordConsent(user.uid, 'termsOfService', LEGAL_VERSIONS.termsOfService);
      await recordConsent(user.uid, 'privacyPolicy', LEGAL_VERSIONS.privacyPolicy);
      markConsentCurrent();
    } catch (err: unknown) {
      setError((err as Error).message ?? 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative bg-white w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl shadow-xl">
        <div className="px-4 sm:px-6 py-4 border-b border-gray-100">
          <h2 className="text-base sm:text-lg font-semibold text-gray-900">We&rsquo;ve updated our policies</h2>
          <p className="text-sm text-gray-500 mt-1">
            Our Terms of Service and Privacy Policy have been updated. Please review and accept to continue using First Whistle.
          </p>
        </div>

        <div className="px-4 sm:px-6 py-4 space-y-4">
          <p className="text-sm text-gray-700">
            Please take a moment to review our updated documents:
          </p>

          <div className="flex flex-col gap-2">
            <a
              href="/legal/terms-of-service"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline font-medium"
            >
              Terms of Service
              <span className="text-xs text-gray-400 font-normal">(v{LEGAL_VERSIONS.termsOfService}, effective {LEGAL_VERSIONS.effectiveDate})</span>
            </a>
            <a
              href="/legal/privacy-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline font-medium"
            >
              Privacy Policy
              <span className="text-xs text-gray-400 font-normal">(v{LEGAL_VERSIONS.privacyPolicy}, effective {LEGAL_VERSIONS.effectiveDate})</span>
            </a>
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer pt-2">
            <input
              type="checkbox"
              checked={agreed}
              onChange={e => setAgreed(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700 leading-relaxed">
              I have read and agree to the updated Terms of Service and Privacy Policy
            </span>
          </label>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex justify-end pt-2">
            <button
              onClick={handleConfirm}
              disabled={!agreed || loading}
              className="inline-flex items-center justify-center px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Saving…' : 'Continue'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
