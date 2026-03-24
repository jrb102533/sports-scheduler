import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MailCheck, Plus, X } from 'lucide-react';
import { AuthLayout } from '@/layouts/AuthLayout';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/store/useAuthStore';
import type { UserRole, RoleMembership } from '@/types';

const roleOptions = [
  { value: 'admin', label: 'Admin — full access' },
  { value: 'league_manager', label: 'League Manager — manage a league' },
  { value: 'coach', label: 'Coach — manage my team' },
  { value: 'player', label: 'Player — view schedule' },
  { value: 'parent', label: 'Parent — follow my child' },
];

const roleDescriptions: Record<UserRole, string> = {
  admin: 'Full access to create and manage all teams, events, and users.',
  league_manager: 'Manage schedules and results for teams in your league.',
  coach: 'Manage your assigned team\'s roster, events, and attendance.',
  player: 'View your team\'s schedule and your own profile.',
  parent: 'View your child\'s team schedule and attendance.',
};

const additionalRoleOptions = roleOptions; // same list for additional roles

interface AdditionalRole {
  role: UserRole;
}

export function SignupPage() {
  const { signup, logout, error, clearError } = useAuthStore();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [role, setRole] = useState<UserRole>('coach');
  const [additionalRoles, setAdditionalRoles] = useState<AdditionalRole[]>([]);
  const [loading, setLoading] = useState(false);
  const [validationError, setValidationError] = useState('');
  const [verificationSent, setVerificationSent] = useState(false);

  function addRole() {
    // Default to the first role that isn't already selected
    const taken = new Set([role, ...additionalRoles.map(r => r.role)]);
    const next = roleOptions.find(o => !taken.has(o.value as UserRole));
    if (next) setAdditionalRoles(prev => [...prev, { role: next.value as UserRole }]);
  }

  function updateAdditionalRole(index: number, newRole: UserRole) {
    setAdditionalRoles(prev => prev.map((r, i) => i === index ? { role: newRole } : r));
  }

  function removeAdditionalRole(index: number) {
    setAdditionalRoles(prev => prev.filter((_, i) => i !== index));
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
      ...additionalRoles.map(r => ({ role: r.role })),
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

          {/* Primary role */}
          <div className="space-y-2">
            <Select
              label="Primary Role"
              value={role}
              onChange={e => setRole(e.target.value as UserRole)}
              options={roleOptions}
            />
            {role && (
              <p className="text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">{roleDescriptions[role]}</p>
            )}
          </div>

          {/* Additional roles */}
          {additionalRoles.map((ar, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="flex-1 space-y-1">
                <Select
                  label={`Additional Role ${i + 1}`}
                  value={ar.role}
                  onChange={e => updateAdditionalRole(i, e.target.value as UserRole)}
                  options={additionalRoleOptions.filter(
                    o => o.value === ar.role || (o.value !== role && !additionalRoles.some((r, j) => j !== i && r.role === o.value))
                  )}
                />
                <p className="text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">{roleDescriptions[ar.role]}</p>
              </div>
              <button
                type="button"
                onClick={() => removeAdditionalRole(i)}
                className="mt-6 p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                aria-label="Remove role"
              >
                <X size={16} />
              </button>
            </div>
          ))}

          {/* Add role button — only show if there are still unused roles */}
          {additionalRoles.length + 1 < roleOptions.length && (
            <button
              type="button"
              onClick={addRole}
              className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              <Plus size={15} /> Add another role
            </button>
          )}
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
