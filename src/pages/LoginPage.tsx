import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { sendEmailVerification } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { AuthLayout } from '@/layouts/AuthLayout';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/store/useAuthStore';

const VERIFY_ERROR_SUBSTRING = 'verify your email';

export function LoginPage() {
  const login = useAuthStore(s => s.login);
  const error = useAuthStore(s => s.error);
  const clearError = useAuthStore(s => s.clearError);
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendSent, setResendSent] = useState(false);
  const [resending, setResending] = useState(false);

  const isVerifyError = error?.toLowerCase().includes(VERIFY_ERROR_SUBSTRING) ?? false;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    clearError();
    setResendSent(false);
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

  async function handleResendVerification() {
    setResending(true);
    try {
      // Sign in temporarily to get the user object, then sign out again
      const { signInWithEmailAndPassword, signOut } = await import('firebase/auth');
      const { user } = await signInWithEmailAndPassword(auth, email, password);
      await sendEmailVerification(user);
      await signOut(auth);
      setResendSent(true);
    } catch {
      // best-effort
    } finally {
      setResending(false);
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
        {error && (
          <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 space-y-2">
            <p>{error}</p>
            {isVerifyError && !resendSent && (
              <button
                type="button"
                onClick={handleResendVerification}
                disabled={resending}
                className="text-blue-600 underline text-sm font-medium disabled:opacity-50"
              >
                {resending ? 'Sending…' : 'Resend verification email'}
              </button>
            )}
            {resendSent && (
              <p className="text-green-700">Verification email sent — check your inbox.</p>
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
