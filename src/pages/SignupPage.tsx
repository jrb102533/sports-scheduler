import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MailCheck } from 'lucide-react';
import { AuthLayout } from '@/layouts/AuthLayout';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { RoleCardPicker } from '@/components/auth/RoleCardPicker';
import { useAuthStore } from '@/store/useAuthStore';
import { auth } from '@/lib/firebase';
import { recordConsent } from '@/lib/consent';
import { LEGAL_VERSIONS } from '@/legal/versions';
import type { UserRole, RoleMembership } from '@/types';

export function SignupPage() {
  const { signup, logout, error, clearError } = useAuthStore();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [role, setRole] = useState<UserRole>('coach');
  const [additionalRoles, setAdditionalRoles] = useState<UserRole[]>([]);
  const [loading, setLoading] = useState(false);
  const [validationError, setValidationError] = useState('');
  const [verificationSent, setVerificationSent] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [agreedToMarketing, setAgreedToMarketing] = useState(false);

  function handlePrimaryRoleChange(newRole: UserRole) {
    setRole(newRole);
    // Remove any additional role that now duplicates the new primary
    setAdditionalRoles(prev => prev.filter(r => r !== newRole));
  }

  function handleAddSecondary(newRole: UserRole) {
    setAdditionalRoles(prev => {
      if (prev.includes(newRole) || newRole === role) return prev;
      return [...prev, newRole];
    });
  }

  function handleRemoveSecondary(roleToRemove: UserRole) {
    setAdditionalRoles(prev => prev.filter(r => r !== roleToRemove));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    clearError();
    setValidationError('');

    if (password !== confirm) { setValidationError('Passwords do not match'); return; }
    if (password.length < 6) { setValidationError('Password must be at least 6 characters'); return; }
    if (!displayName.trim()) { setValidationError('Name is required'); return; }

    // Build memberships from primary + additional roles
    const memberships: RoleMembership[] = [
      { role, isPrimary: true },
      ...additionalRoles.map(r => ({ role: r })),
    ];

    setLoading(true);
    try {
      await signup(email, password, displayName.trim(), role, undefined, memberships);

      // Account created — show the verification screen immediately.
      // Consent recording and logout are best-effort and must not block or hide this.
      setVerificationSent(true);

      const uid = auth.currentUser?.uid;
      if (uid) {
        try {
          await recordConsent(uid, 'termsOfService', LEGAL_VERSIONS.termsOfService);
          await recordConsent(uid, 'privacyPolicy', LEGAL_VERSIONS.privacyPolicy);
          if (agreedToMarketing) await recordConsent(uid, 'marketingEmail', '1.0');
        } catch (e) {
          console.warn('Consent recording failed (non-blocking):', e);
        }
      }
      logout().catch(() => {});
    } catch {
      // signup itself failed — error set in store, stay on form
    } finally {
      setLoading(false);
    }
  }

  const displayedError = validationError || error;

  if (verificationSent) {
    return (
      <AuthLayout title="Check your email" subtitle="One more step">
        <div className="text-center space-y-4">
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center">
              <MailCheck size={32} className="text-blue-600" />
            </div>
          </div>
          <p className="text-sm text-gray-600">
            We sent a verification link to <span className="font-medium text-gray-900">{email}</span>.
            Click the link in that email, then sign in below.
          </p>
          <Button className="w-full" onClick={() => navigate('/login')}>Go to Sign In</Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Create account" subtitle="Join First Whistle">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input label="Full Name" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Jane Smith" required />
        <Input label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required />
        <Input label="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 6 characters" required showToggle />
        <Input label="Confirm Password" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="••••••••" required showToggle />

        <div className="border-t border-gray-100 pt-4 space-y-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Your Role(s)</p>
          <RoleCardPicker
            primaryRole={role}
            additionalRoles={additionalRoles}
            onPrimaryChange={handlePrimaryRoleChange}
            onAddSecondary={handleAddSecondary}
            onRemoveSecondary={handleRemoveSecondary}
          />
        </div>

        {/* Consent notice */}
        <div className="border-t border-gray-100 pt-4 space-y-3">
          <p className="text-xs text-gray-500 leading-relaxed">
            By creating an account, you agree to First Whistle&rsquo;s{' '}
            <a
              href="/legal/terms-of-service"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline font-medium"
            >
              Terms of Service
            </a>{' '}
            and{' '}
            <a
              href="/legal/privacy-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline font-medium"
            >
              Privacy Policy
            </a>
            .
          </p>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={agreedToTerms}
              onChange={e => setAgreedToTerms(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-xs text-gray-700 leading-relaxed">
              I agree to the Terms of Service and Privacy Policy{' '}
              <span className="text-red-500 font-medium">(required)</span>
            </span>
          </label>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={agreedToMarketing}
              onChange={e => setAgreedToMarketing(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-xs text-gray-700 leading-relaxed">
              I&rsquo;d like to receive product updates and tips by email{' '}
              <span className="text-gray-400">(optional)</span>
            </span>
          </label>
        </div>

        {displayedError && (
          <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{displayedError}</div>
        )}

        <Button type="submit" className="w-full" disabled={loading || !agreedToTerms}>
          {loading ? 'Creating account…' : 'Create Account'}
        </Button>
      </form>
      <p className="text-center text-sm text-gray-500 mt-6">
        Already have an account?{' '}
        <Link to="/login" className="text-blue-600 font-medium hover:underline">Sign in</Link>
      </p>
    </AuthLayout>
  );
}
