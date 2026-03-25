import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MailCheck } from 'lucide-react';
import { AuthLayout } from '@/layouts/AuthLayout';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { RoleCardPicker } from '@/components/auth/RoleCardPicker';
import { useAuthStore } from '@/store/useAuthStore';
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
      await logout();
      setVerificationSent(true);
    } catch {
      // error set in store
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
        <Input label="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 6 characters" required />
        <Input label="Confirm Password" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="••••••••" required />

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

        {displayedError && (
          <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{displayedError}</div>
        )}

        <Button type="submit" className="w-full" disabled={loading}>
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
