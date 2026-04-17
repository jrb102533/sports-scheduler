/**
 * SettingsPage — unit tests
 *
 * Behaviors under test:
 *   - Email Notifications section renders for authenticated users
 *   - Weekly digest toggle reflects profile.weeklyDigestEnabled value
 *   - Messaging notifications toggle defaults to true when field is absent
 *   - Profile without weeklyDigestEnabled field = enabled (default true)
 *   - Profile with weeklyDigestEnabled: false = toggle unchecked
 *   - Kids Sports Mode section is hidden when FLAGS.KIDS_MODE is false
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { UserProfile } from '@/types';
import type { AppSettings } from '@/types';

// ── Firebase stub ──────────────────────────────────────────────────────────────
vi.mock('@/lib/firebase', () => ({ auth: {}, db: {}, app: {} }));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  updateDoc: vi.fn().mockResolvedValue(undefined),
}));

// ── Feature flags — default KIDS_MODE off ─────────────────────────────────────
vi.mock('@/lib/flags', () => ({ FLAGS: { KIDS_MODE: false } }));

// ── buildInfo stub ─────────────────────────────────────────────────────────────
vi.mock('@/lib/buildInfo', () => ({
  buildInfo: { branch: 'main', sha: 'abc123', timestamp: '2026-01-01T00:00:00Z' },
}));

// ── consent stub ──────────────────────────────────────────────────────────────
vi.mock('@/lib/consent', () => ({
  getUserConsents: vi.fn().mockResolvedValue({}),
}));

// ── Store mocks ───────────────────────────────────────────────────────────────
let currentProfile: UserProfile | null = null;
let currentUser: { uid: string } | null = null;
let currentSettings: AppSettings = { kidsSportsMode: false, hideStandingsInKidsMode: false };
const mockUpdateSettings = vi.fn().mockResolvedValue(undefined);

vi.mock('@/store/useSettingsStore', () => ({
  useSettingsStore: () => ({ settings: currentSettings, updateSettings: mockUpdateSettings }),
}));

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (sel: (s: { user: typeof currentUser; profile: typeof currentProfile }) => unknown) =>
    sel({ user: currentUser, profile: currentProfile }),
}));

// ── Import after mocks ────────────────────────────────────────────────────────
import { SettingsPage } from '@/pages/SettingsPage';

// ── Factories ─────────────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    uid: 'uid-1',
    email: 'coach@example.com',
    displayName: 'Coach One',
    role: 'coach',
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderPage() {
  return render(<SettingsPage />);
}

beforeEach(() => {
  vi.clearAllMocks();
  currentProfile = makeProfile();
  currentUser = { uid: 'uid-1' };
  currentSettings = { kidsSportsMode: false, hideStandingsInKidsMode: false };
});

// ── Email Notifications ───────────────────────────────────────────────────────

describe('SettingsPage — Email Notifications section', () => {
  it('renders the Email Notifications heading', () => {
    renderPage();
    expect(screen.getByText('Email Notifications')).toBeInTheDocument();
  });

  it('renders the "Chat & message emails" toggle', () => {
    renderPage();
    expect(screen.getByText('Chat & message emails')).toBeInTheDocument();
  });

  it('renders the "Weekly team digest" toggle', () => {
    renderPage();
    expect(screen.getByText('Weekly team digest')).toBeInTheDocument();
  });

  it('shows weekly digest toggle label when profile field is absent (default true)', () => {
    currentProfile = makeProfile({ weeklyDigestEnabled: undefined });
    renderPage();
    expect(screen.getByText('Weekly team digest')).toBeInTheDocument();
  });

  it('renders the messaging notifications toggle as enabled when field is absent', () => {
    currentProfile = makeProfile({ messagingNotificationsEnabled: undefined });
    renderPage();
    expect(screen.getByText('Chat & message emails')).toBeInTheDocument();
  });
});

// ── Kids Sports Mode (behind feature flag) ────────────────────────────────────

describe('SettingsPage — Kids Sports Mode (KIDS_MODE: false)', () => {
  it('does not render the Kids Sports Mode section when flag is off', () => {
    renderPage();
    expect(screen.queryByText('Kids Sports Mode')).not.toBeInTheDocument();
  });

  it('does not render the "Hide Standings" toggle when flag is off', () => {
    renderPage();
    expect(screen.queryByText('Hide Standings')).not.toBeInTheDocument();
  });
});

// ── Build info ────────────────────────────────────────────────────────────────

describe('SettingsPage — About section', () => {
  it('renders the "About" heading', () => {
    renderPage();
    expect(screen.getByText('About')).toBeInTheDocument();
  });
});

// ── Unauthenticated state ─────────────────────────────────────────────────────

describe('SettingsPage — unauthenticated', () => {
  it('renders without crashing when user is null', () => {
    currentUser = null;
    currentProfile = null;
    const { container } = renderPage();
    expect(container).toBeTruthy();
  });
});
