import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { sendPasswordResetEmail } from 'firebase/auth';
import { AuthLayout } from '@/layouts/AuthLayout';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/store/useAuthStore';
import { auth } from '@/lib/firebase';

export function LoginPage() {
  const { login, error, clearError, resendVerificationEmail } = useAuthStore();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [resentVerification, setResentVerification] = useState(false);
  const [resending, setResending] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetError, setResetError] = useState('');
  const [sendingReset, setSendingReset] = useState(false);

  async function handleResendVerification() {
    setResending(true);
    try {
      await resendVerificationEmail(email, password);
      setResentVerification(true);
    } catch {
      // error set in store
    } finally {
      setResending(false);
    }
  }

  async function handleForgotPassword() {
    if (!email.trim()) { setResetError('Enter your email address above first.'); return; }
    setSendingReset(true);
    setResetError('');
    try {
      await sendPasswordResetEmail(auth, email.trim(), {
        url: `${import.meta.env.VITE_APP_URL}/auth/action`,
      });
      setResetSent(true);
    } catch {
      setResetError('Could not send reset email. Check the address and try again.');
    } finally {
      setSendingReset(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    clearError();
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch {
      // error set in store
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to your account">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@example.com"
          required
        />
        <div>
          <Input
            label="Password"
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            showToggle
          />
          <div className="mt-1 text-right">
            {resetSent ? (
              <span className="text-xs text-green-600">Reset email sent — check your inbox.</span>
            ) : (
              <button
                type="button"
                onClick={handleForgotPassword}
                disabled={sendingReset}
                className="text-xs text-blue-600 hover:underline disabled:opacity-50"
              >
                {sendingReset ? 'Sending…' : 'Forgot password?'}
              </button>
            )}
          </div>
          {resetError && <p className="text-xs text-red-600 mt-1">{resetError}</p>}
        </div>
        {error && (
          <div role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 space-y-2">
            <p>{error}</p>
            {error.includes('verify your email') && (
              resentVerification ? (
                <p className="text-green-600 text-xs">Verification email sent! Check your inbox.</p>
              ) : (
                <button
                  type="button"
                  onClick={handleResendVerification}
                  disabled={resending}
                  className="text-xs text-blue-600 hover:underline disabled:opacity-50"
                >
                  {resending ? 'Sending…' : 'Resend verification email'}
                </button>
              )
            )}
          </div>
        )}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign In'}
        </Button>
      </form>
      <p className="text-center text-sm text-gray-500 mt-6">
        Don't have an account?{' '}
        <Link to="/signup" className="text-blue-600 font-medium hover:underline">Sign up</Link>
      </p>
    </AuthLayout>
  );
}
