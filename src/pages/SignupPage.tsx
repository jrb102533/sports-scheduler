import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { AuthLayout } from '@/layouts/AuthLayout';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { RoleCardPicker } from '@/components/auth/RoleCardPicker';
import { useAuthStore } from '@/store/useAuthStore';
import { auth, functions } from '@/lib/firebase';
import { recordConsent } from '@/lib/consent';
import { LEGAL_VERSIONS } from '@/legal/versions';
import type { UserRole, RoleMembership } from '@/types';

const verifyInvitedUserFn = httpsCallable<{ inviteSecret: string }, { found: boolean }>(
  functions, 'verifyInvitedUser'
);

export function SignupPage() {
  const { signup, login, error, clearError, verificationEmailSent, clearVerificationEmailSent } = useAuthStore();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const inviteSecret = searchParams.get('inviteSecret') ?? '';
  if (inviteSecret) {
    window.history.replaceState({}, '', window.location.pathname);
  }
  const hasInvite = inviteSecret !== '';

  // invite path toggle: 'signup' | 'signin'
  const [invitePath, setInvitePath] = useState<'signup' | 'signin'>('signup');

  // signup form state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [role, setRole] = useState<UserRole>('coach');
  const [additionalRoles, setAdditionalRoles] = useState<UserRole[]>([]);
  const [loading, setLoading] = useState(false);
  const [validationError, setValidationError] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [agreedToMarketing, setAgreedToMarketing] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState('');
  const [emailInUse, setEmailInUse] = useState(false);

  // sign-in path state (invite flow only)
  const [signinEmail, setSigninEmail] = useState('');
  const [signinPassword, setSigninPassword] = useState('');
  const [signinLoading, setSigninLoading] = useState(false);
  const [signinError, setSigninError] = useState('');

  async function handleSigninAndAccept(e: React.FormEvent) {
    e.preventDefault();
    clearError();
    setSigninError('');
    setSigninLoading(true);
    try {
      await login(signinEmail, signinPassword);
      await verifyInvitedUserFn({ inviteSecret });
      navigate('/home');
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? '';
      if (code === 'auth/invalid-credential' || code === 'auth/user-not-found') {
        setSigninError('no-account');
      } else {
        setSigninError((err as Error).message ?? 'Something went wrong. Please try again.');
      }
    } finally {
      setSigninLoading(false);
    }
  }

  function handlePrimaryRoleChange(newRole: UserRole) {
    setRole(newRole);
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
    setEmailInUse(false);

    if (password !== confirm) { setValidationError('Passwords do not match'); return; }
    if (password.length < 6) { setValidationError('Password must be at least 6 characters'); return; }
    if (!firstName.trim()) { setValidationError('First name is required'); return; }
    if (!lastName.trim()) { setValidationError('Last name is required'); return; }
    const displayName = `${firstName.trim()} ${lastName.trim()}`;

    const memberships: RoleMembership[] = [
      { role, isPrimary: true },
      ...additionalRoles.map(r => ({ role: r })),
    ];

    setLoading(true);
    try {
      setSubmittedEmail(email);
      await signup(email, password, displayName, role, undefined, memberships, inviteSecret);

      if (useAuthStore.getState().verificationEmailSent) return;

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

      navigate('/');
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? '';
      if (code === 'auth/email-already-in-use') {
        setEmailInUse(true);
        setValidationError('An account with that email already exists.');
      }
    } finally {
      setLoading(false);
    }
  }

  const displayedError = validationError || error;

  if (verificationEmailSent) {
    return (
      <AuthLayout title="Check your email" subtitle="One more step">
        <div className="space-y-4 text-center">
          <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto">
            <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <p className="text-sm text-gray-600">
              We sent a verification link to <strong>{submittedEmail}</strong>.
              Click the link in that email to activate your account.
            </p>
          </div>
          <p className="text-xs text-gray-400">
            Didn't receive it? Check your spam folder.
          </p>
          <button
            onClick={() => clearVerificationEmailSent()}
            className="text-sm text-blue-600 hover:underline"
          >
            Back to sign up
          </button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Create account" subtitle="Join First Whistle">
      {hasInvite && (
        <div className="flex rounded-lg border border-gray-200 overflow-hidden mb-4">
          <button
            type="button"
            onClick={() => { setInvitePath('signup'); clearError(); setSigninError(''); }}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${invitePath === 'signup' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            I&rsquo;m new here
          </button>
          <button
            type="button"
            onClick={() => { setInvitePath('signin'); clearError(); setValidationError(''); setEmailInUse(false); }}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors border-l border-gray-200 ${invitePath === 'signin' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            I already have an account
          </button>
        </div>
      )}

      {hasInvite && invitePath === 'signin' ? (
        <form onSubmit={handleSigninAndAccept} className="space-y-4">
          <Input
            label="Email"
            type="email"
            name="email"
            autoComplete="email"
            value={signinEmail}
            onChange={e => setSigninEmail(e.target.value)}
            placeholder="you@example.com"
            required
          />
          <Input
            label="Password"
            type="password"
            name="current-password"
            autoComplete="current-password"
            value={signinPassword}
            onChange={e => setSigninPassword(e.target.value)}
            placeholder="••••••••"
            required
            showToggle
          />

          {signinError === 'no-account' ? (
            <div role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
              No account found with that email.{' '}
              <button
                type="button"
                onClick={() => { setInvitePath('signup'); setSigninError(''); clearError(); }}
                className="font-medium underline hover:no-underline"
              >
                Create one instead?
              </button>
            </div>
          ) : signinError ? (
            <div role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{signinError}</div>
          ) : error ? (
            <div role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>
          ) : null}

          <Button type="submit" className="w-full" disabled={signinLoading}>
            {signinLoading ? 'Signing in…' : 'Sign in & Accept Invite'}
          </Button>
        </form>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="First Name"
              name="given-name"
              autoComplete="given-name"
              value={firstName}
              onChange={e => setFirstName(e.target.value)}
              placeholder="Jane"
              required
            />
            <Input
              label="Last Name"
              name="family-name"
              autoComplete="family-name"
              value={lastName}
              onChange={e => setLastName(e.target.value)}
              placeholder="Smith"
              required
            />
          </div>
          <Input label="Email" type="email" name="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required />
          <Input label="Password" type="password" name="new-password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 6 characters" required showToggle />
          <Input label="Confirm Password" type="password" name="new-password-confirm" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="••••••••" required showToggle />

          {!hasInvite && (
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
          )}

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
            <div role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
              {displayedError}
              {hasInvite && emailInUse && (
                <>
                  {' '}
                  <button
                    type="button"
                    onClick={() => { setInvitePath('signin'); clearError(); setValidationError(''); setEmailInUse(false); }}
                    className="font-medium underline hover:no-underline"
                  >
                    Sign in instead?
                  </button>
                </>
              )}
            </div>
          )}

          <Button type="submit" className="w-full" disabled={loading || !agreedToTerms}>
            {loading ? 'Creating account…' : 'Create Account'}
          </Button>
        </form>
      )}

      {!hasInvite && (
        <p className="text-center text-sm text-gray-500 mt-6">
          Already have an account?{' '}
          <Link to="/login" className="text-blue-600 font-medium hover:underline">Sign in</Link>
        </p>
      )}
    </AuthLayout>
  );
}
