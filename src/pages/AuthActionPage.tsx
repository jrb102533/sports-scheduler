import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { confirmPasswordReset, applyActionCode } from 'firebase/auth';
import { AuthLayout } from '@/layouts/AuthLayout';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { auth } from '@/lib/firebase';

type PageState = 'loading' | 'form' | 'success' | 'error' | 'invalid';

export function AuthActionPage() {
  const [searchParams] = useSearchParams();
  const mode = searchParams.get('mode');
  const oobCode = searchParams.get('oobCode');

  const [pageState, setPageState] = useState<PageState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!oobCode) {
      setPageState('invalid');
      return;
    }

    if (mode === 'verifyEmail') {
      applyActionCode(auth, oobCode)
        .then(() => setPageState('success'))
        .catch((err: unknown) => {
          const code = (err as { code?: string }).code ?? '';
          if (code === 'auth/expired-action-code' || code === 'auth/invalid-action-code') {
            setErrorMessage('This verification link has expired or already been used.');
          } else {
            setErrorMessage('We couldn\'t verify your email. Please try signing up again.');
          }
          setPageState('error');
        });
      return;
    }

    if (mode === 'resetPassword') {
      setPageState('form');
      return;
    }

    setPageState('invalid');
  }, [mode, oobCode]);

  function validate(): boolean {
    let valid = true;

    if (newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters.');
      valid = false;
    } else {
      setPasswordError('');
    }

    if (confirmPassword !== newPassword) {
      setConfirmError('Passwords do not match.');
      valid = false;
    } else {
      setConfirmError('');
    }

    return valid;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError('');

    if (!validate()) return;
    if (!oobCode) return;

    setSubmitting(true);
    try {
      await confirmPasswordReset(auth, oobCode, newPassword);
      setPageState('success');
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'auth/expired-action-code' || code === 'auth/invalid-action-code') {
        setSubmitError('This reset link has expired or already been used. Please request a new one.');
      } else {
        setSubmitError('Something went wrong. Please try again or request a new reset link.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (pageState === 'loading') {
    return (
      <AuthLayout title="Just a moment…" subtitle="">
        <p className="text-sm text-gray-500 text-center">Verifying your link…</p>
      </AuthLayout>
    );
  }

  if (pageState === 'invalid') {
    return (
      <AuthLayout title="Invalid link" subtitle="This link is invalid or has expired.">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            The link is missing required information. This can happen if it was copied
            incorrectly or has already been used.
          </p>
          <Link
            to="/login"
            className="block w-full text-center px-4 py-2 text-sm font-medium text-white bg-[#1B3A6B] hover:bg-[#f97316] rounded-lg transition-colors"
          >
            Back to sign in
          </Link>
        </div>
      </AuthLayout>
    );
  }

  if (pageState === 'error') {
    return (
      <AuthLayout title="Verification failed" subtitle="">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">{errorMessage}</p>
          <Link
            to="/signup"
            className="block w-full text-center px-4 py-2 text-sm font-medium text-white bg-[#1B3A6B] hover:bg-[#f97316] rounded-lg transition-colors"
          >
            Back to sign up
          </Link>
        </div>
      </AuthLayout>
    );
  }

  if (pageState === 'success' && mode === 'verifyEmail') {
    return (
      <AuthLayout title="Email verified!" subtitle="Your account is ready to go.">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Your email has been verified. You can now sign in to your account.
          </p>
          <Link
            to="/login"
            className="block w-full text-center px-4 py-2 text-sm font-medium text-white bg-[#1B3A6B] hover:bg-[#f97316] rounded-lg transition-colors"
          >
            Sign in
          </Link>
        </div>
      </AuthLayout>
    );
  }

  if (pageState === 'success') {
    return (
      <AuthLayout title="Password updated" subtitle="Your password has been reset successfully.">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            You can now sign in with your new password.
          </p>
          <Link
            to="/login"
            className="block w-full text-center px-4 py-2 text-sm font-medium text-white bg-[#1B3A6B] hover:bg-[#f97316] rounded-lg transition-colors"
          >
            Back to sign in
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Reset your password" subtitle="Enter a new password for your account.">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <Input
          label="New password"
          type="password"
          name="new-password"
          autoComplete="new-password"
          value={newPassword}
          onChange={e => setNewPassword(e.target.value)}
          placeholder="••••••••"
          error={passwordError}
          showToggle
          required
        />
        <Input
          label="Confirm password"
          type="password"
          name="confirm-password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={e => setConfirmPassword(e.target.value)}
          placeholder="••••••••"
          error={confirmError}
          showToggle
          required
        />
        {submitError && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{submitError}</p>
        )}
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? 'Updating…' : 'Set new password'}
        </Button>
      </form>
      <p className="text-center text-sm text-gray-500 mt-6">
        Remembered it?{' '}
        <Link to="/login" className="text-blue-600 font-medium hover:underline">
          Back to sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
