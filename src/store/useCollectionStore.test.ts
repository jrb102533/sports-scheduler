/**
 * useCollectionStore — unit tests
 *
 * Behaviors under test:
 *   - loadCollection picks the most recent non-expired collection
 *   - loadCollection ignores expired collections
 *   - loadCollection sets activeCollection to null when no valid collection exists
 *   - loadWizardDraft populates wizardDraft when doc exists, null when not
 *   - saveWizardDraft writes to Firestore with updatedAt and updates local state
 *   - clearWizardDraft deletes the doc and sets wizardDraft to null
 *   - createCollection writes with status: 'open', sets activeCollection, returns id
 *   - closeCollection calls updateDoc with status: 'closed', optimistically updates state
 *   - reopenCollection calls updateDoc with status: 'open' and new dueDate
 *   - submitResponse writes to Firestore, upserts into responses state
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AvailabilityCollection, CoachAvailabilityResponse, WizardDraft } from '@/types';

// ── Firestore mock ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

const mockSetDoc = vi.fn<AnyFn>();
const mockUpdateDoc = vi.fn<AnyFn>();
const mockDeleteDoc = vi.fn<AnyFn>();
const mockGetDocs = vi.fn<AnyFn>();
const mockOnSnapshot = vi.fn<AnyFn>(() => () => {});
const mockDoc = vi.fn<AnyFn>(() => ({}));
const mockCollection = vi.fn<AnyFn>(() => ({}));

vi.mock('firebase/firestore', () => ({
  collection: (...args: any[]) => mockCollection(...args),
  onSnapshot: (...args: any[]) => mockOnSnapshot(...args),
  doc: (...args: any[]) => mockDoc(...args),
  setDoc: (...args: any[]) => mockSetDoc(...args),
  updateDoc: (...args: any[]) => mockUpdateDoc(...args),
  deleteDoc: (...args: any[]) => mockDeleteDoc(...args),
  getDocs: (...args: any[]) => mockGetDocs(...args),
}));

vi.mock('@/lib/firebase', () => ({ db: {} }));

// ── Import store after mocks ──────────────────────────────────────────────────

import { useCollectionStore } from './useCollectionStore';

// ── Factories ─────────────────────────────────────────────────────────────────

function makeCollection(id: string, overrides: Partial<AvailabilityCollection> = {}): AvailabilityCollection {
  return {
    id,
    leagueId: 'league-1',
    dueDate: '2026-06-30',
    status: 'open',
    createdAt: `2026-01-0${id}T00:00:00.000Z`,
    createdBy: 'lm-uid',
    ...overrides,
  } as AvailabilityCollection;
}

function makeResponse(coachUid: string): CoachAvailabilityResponse {
  return {
    coachUid,
    coachName: `Coach ${coachUid}`,
    teamId: 'team-1',
    teamName: 'Thunder FC',
    submittedAt: '2026-01-01T00:00:00.000Z',
    windows: [],
  } as CoachAvailabilityResponse;
}

function makeCollectionSnapshot(collections: AvailabilityCollection[]) {
  return { docs: collections.map(c => ({ id: c.id, data: () => c })) };
}

function makeResponseSnapshot(responses: CoachAvailabilityResponse[]) {
  return { docs: responses.map(r => ({ data: () => r })) };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockSetDoc.mockResolvedValue(undefined);
  mockUpdateDoc.mockResolvedValue(undefined);
  mockGetDocs.mockResolvedValue(makeResponseSnapshot([]));
  useCollectionStore.setState({
    activeCollection: null,
    responses: [],
    responseSummaries: [],
    wizardDraft: null,
  });
});

// ── loadCollection() ──────────────────────────────────────────────────────────

describe('useCollectionStore — loadCollection', () => {
  it('sets activeCollection to the most recent non-expired collection', async () => {
    const older = makeCollection('1', { createdAt: '2026-01-01T00:00:00.000Z', status: 'open' });
    const newer = makeCollection('2', { createdAt: '2026-02-01T00:00:00.000Z', status: 'open' });

    mockOnSnapshot.mockImplementation((_ref, cb) => {
      cb(makeCollectionSnapshot([older, newer]));
      return () => {};
    });

    useCollectionStore.getState().loadCollection('league-1');
    // Wait for the async getDocs inside the snapshot handler
    await Promise.resolve();

    expect(useCollectionStore.getState().activeCollection?.id).toBe('2');
  });

  it('ignores expired collections', async () => {
    const expired = makeCollection('1', { status: 'expired' });
    mockOnSnapshot.mockImplementation((_ref, cb) => {
      cb(makeCollectionSnapshot([expired]));
      return () => {};
    });

    useCollectionStore.getState().loadCollection('league-1');
    await Promise.resolve();

    expect(useCollectionStore.getState().activeCollection).toBeNull();
  });

  it('sets activeCollection to null and clears responses when no valid collection exists', async () => {
    useCollectionStore.setState({ responses: [makeResponse('coach-1')] });
    mockOnSnapshot.mockImplementation((_ref, cb) => {
      cb(makeCollectionSnapshot([]));
      return () => {};
    });

    useCollectionStore.getState().loadCollection('league-1');
    await Promise.resolve();

    expect(useCollectionStore.getState().activeCollection).toBeNull();
    expect(useCollectionStore.getState().responses).toEqual([]);
  });

  it('loads responses when an active collection is found', async () => {
    const collection = makeCollection('1');
    const responses = [makeResponse('coach-A')];

    mockOnSnapshot.mockImplementation((_ref, cb) => {
      cb(makeCollectionSnapshot([collection]));
      return () => {};
    });
    mockGetDocs.mockResolvedValue(makeResponseSnapshot(responses));

    useCollectionStore.getState().loadCollection('league-1');
    await Promise.resolve();

    expect(useCollectionStore.getState().responses).toHaveLength(1);
    expect(useCollectionStore.getState().responses[0].coachUid).toBe('coach-A');
  });

  it('returns an unsubscribe function', () => {
    const unsub = vi.fn();
    mockOnSnapshot.mockReturnValue(unsub);
    const result = useCollectionStore.getState().loadCollection('league-1');
    expect(typeof result).toBe('function');
  });
});

// ── loadWizardDraft() ─────────────────────────────────────────────────────────
// FW-54: path moved to leagues/{leagueId}/seasons/{seasonId}/wizardDraft/draft.
// Tests verify both the correct seasonId parameter and the season-scoped path.

describe('useCollectionStore — loadWizardDraft', () => {
  it('subscribes to the season-scoped Firestore path', () => {
    mockOnSnapshot.mockImplementation((_ref, cb) => {
      cb({ exists: () => false });
      return () => {};
    });

    useCollectionStore.getState().loadWizardDraft('league-1', 'season-1');

    // doc() must be called with the season-scoped path segments
    expect(mockDoc).toHaveBeenCalledWith(
      expect.anything(), // db
      'leagues', 'league-1', 'seasons', 'season-1', 'wizardDraft', 'draft'
    );
  });

  it('sets wizardDraft when the doc exists', () => {
    const draft: WizardDraft = {
      mode: 'season', currentStep: 'step1', stepData: {}, updatedAt: '2026-01-01T00:00:00.000Z', createdBy: 'lm-uid',
    };
    mockOnSnapshot.mockImplementation((_ref, cb) => {
      cb({ exists: () => true, data: () => draft });
      return () => {};
    });

    useCollectionStore.getState().loadWizardDraft('league-1', 'season-1');
    expect(useCollectionStore.getState().wizardDraft).not.toBeNull();
  });

  it('sets wizardDraft to null when the doc does not exist', () => {
    useCollectionStore.setState({ wizardDraft: { mode: 'season', currentStep: 'x', stepData: {}, updatedAt: '', createdBy: '' } });
    mockOnSnapshot.mockImplementation((_ref, cb) => {
      cb({ exists: () => false });
      return () => {};
    });

    useCollectionStore.getState().loadWizardDraft('league-1', 'season-1');
    expect(useCollectionStore.getState().wizardDraft).toBeNull();
  });

  it('returns an unsubscribe function', () => {
    const unsub = vi.fn();
    mockOnSnapshot.mockReturnValue(unsub);
    const result = useCollectionStore.getState().loadWizardDraft('league-1', 'season-1');
    expect(typeof result).toBe('function');
  });
});

// ── saveWizardDraft() ─────────────────────────────────────────────────────────
// FW-54: now requires seasonId as second arg; writes to season-scoped path.

describe('useCollectionStore — saveWizardDraft', () => {
  const draftInput: Omit<WizardDraft, 'updatedAt'> = {
    mode: 'season', currentStep: 'step2', stepData: {}, createdBy: 'lm-uid',
  };

  it('writes to the season-scoped Firestore path', async () => {
    await useCollectionStore.getState().saveWizardDraft('league-1', 'season-1', draftInput);

    expect(mockDoc).toHaveBeenCalledWith(
      expect.anything(), // db
      'leagues', 'league-1', 'seasons', 'season-1', 'wizardDraft', 'draft'
    );
    expect(mockSetDoc).toHaveBeenCalledOnce();
  });

  it('sets wizardDraft in local state with updatedAt', async () => {
    await useCollectionStore.getState().saveWizardDraft('league-1', 'season-1', draftInput);
    const draft = useCollectionStore.getState().wizardDraft;
    expect(draft).not.toBeNull();
    expect(typeof draft?.updatedAt).toBe('string');
  });

  it('does not call deleteDoc on save', async () => {
    await useCollectionStore.getState().saveWizardDraft('league-1', 'season-1', draftInput);
    expect(mockDeleteDoc).not.toHaveBeenCalled();
  });
});

// ── clearWizardDraft() ────────────────────────────────────────────────────────
// FW-54: now requires seasonId as second arg; deletes from season-scoped path.

describe('useCollectionStore — clearWizardDraft', () => {
  it('deletes from the season-scoped Firestore path', async () => {
    await useCollectionStore.getState().clearWizardDraft('league-1', 'season-1');

    expect(mockDoc).toHaveBeenCalledWith(
      expect.anything(), // db
      'leagues', 'league-1', 'seasons', 'season-1', 'wizardDraft', 'draft'
    );
    expect(mockDeleteDoc).toHaveBeenCalledOnce();
  });

  it('calls deleteDoc, not setDoc', async () => {
    await useCollectionStore.getState().clearWizardDraft('league-1', 'season-1');
    expect(mockDeleteDoc).toHaveBeenCalledOnce();
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it('sets wizardDraft to null in local state', async () => {
    useCollectionStore.setState({ wizardDraft: { mode: 'season', currentStep: 'x', stepData: {}, updatedAt: '', createdBy: '' } });
    await useCollectionStore.getState().clearWizardDraft('league-1', 'season-1');
    expect(useCollectionStore.getState().wizardDraft).toBeNull();
  });
});

// ── createCollection() ────────────────────────────────────────────────────────

describe('useCollectionStore — createCollection', () => {
  it('calls setDoc once', async () => {
    await useCollectionStore.getState().createCollection('league-1', '2026-06-30', 'lm-uid');
    expect(mockSetDoc).toHaveBeenCalledOnce();
  });

  it('returns a non-empty string id', async () => {
    const id = await useCollectionStore.getState().createCollection('league-1', '2026-06-30', 'lm-uid');
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('writes status: open to Firestore', async () => {
    await useCollectionStore.getState().createCollection('league-1', '2026-06-30', 'lm-uid');
    const written = mockSetDoc.mock.calls[0][1] as AvailabilityCollection;
    expect(written.status).toBe('open');
  });

  it('sets activeCollection in local state', async () => {
    await useCollectionStore.getState().createCollection('league-1', '2026-06-30', 'lm-uid');
    expect(useCollectionStore.getState().activeCollection).not.toBeNull();
    expect(useCollectionStore.getState().activeCollection?.status).toBe('open');
  });

  it('clears responses on creation', async () => {
    useCollectionStore.setState({ responses: [makeResponse('coach-1')] });
    await useCollectionStore.getState().createCollection('league-1', '2026-06-30', 'lm-uid');
    expect(useCollectionStore.getState().responses).toEqual([]);
  });
});

// ── closeCollection() ─────────────────────────────────────────────────────────

describe('useCollectionStore — closeCollection', () => {
  it('calls updateDoc with status: closed', async () => {
    await useCollectionStore.getState().closeCollection('league-1', 'col-1');
    const patch = mockUpdateDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(patch.status).toBe('closed');
    expect(typeof patch.closedAt).toBe('string');
  });

  it('optimistically updates activeCollection status to closed', async () => {
    useCollectionStore.setState({ activeCollection: makeCollection('col-1', { status: 'open' }) });
    await useCollectionStore.getState().closeCollection('league-1', 'col-1');
    expect(useCollectionStore.getState().activeCollection?.status).toBe('closed');
  });
});

// ── reopenCollection() ────────────────────────────────────────────────────────

describe('useCollectionStore — reopenCollection', () => {
  it('calls updateDoc with status: open and new dueDate', async () => {
    await useCollectionStore.getState().reopenCollection('league-1', 'col-1', '2026-09-30');
    const patch = mockUpdateDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(patch.status).toBe('open');
    expect(patch.dueDate).toBe('2026-09-30');
    expect(patch.closedAt).toBeNull();
  });

  it('optimistically updates activeCollection status to open', async () => {
    useCollectionStore.setState({
      activeCollection: makeCollection('col-1', { status: 'closed' }),
    });
    await useCollectionStore.getState().reopenCollection('league-1', 'col-1', '2026-09-30');
    expect(useCollectionStore.getState().activeCollection?.status).toBe('open');
    expect(useCollectionStore.getState().activeCollection?.dueDate).toBe('2026-09-30');
  });
});

// ── submitResponse() ──────────────────────────────────────────────────────────

describe('useCollectionStore — submitResponse', () => {
  it('calls setDoc once', async () => {
    await useCollectionStore.getState().submitResponse('league-1', 'col-1', makeResponse('coach-A'));
    expect(mockSetDoc).toHaveBeenCalledOnce();
  });

  it('adds the response with submittedAt to local state', async () => {
    await useCollectionStore.getState().submitResponse('league-1', 'col-1', makeResponse('coach-A'));
    const responses = useCollectionStore.getState().responses;
    expect(responses).toHaveLength(1);
    expect(typeof responses[0].submittedAt).toBe('string');
  });

  it('upserts — replaces an existing response from the same coach', async () => {
    useCollectionStore.setState({ responses: [makeResponse('coach-A')] });
    await useCollectionStore.getState().submitResponse('league-1', 'col-1', makeResponse('coach-A'));
    // Should still have only one response for coach-A
    expect(useCollectionStore.getState().responses).toHaveLength(1);
  });

  it('appends when a different coach submits', async () => {
    useCollectionStore.setState({ responses: [makeResponse('coach-A')] });
    await useCollectionStore.getState().submitResponse('league-1', 'col-1', makeResponse('coach-B'));
    expect(useCollectionStore.getState().responses).toHaveLength(2);
  });
});
