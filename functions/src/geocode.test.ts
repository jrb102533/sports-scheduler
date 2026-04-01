import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock firebase-admin ───────────────────────────────────────────────────────

const mockUpdate = vi.fn().mockResolvedValue(undefined);
const mockDocRef = vi.fn(() => ({ update: mockUpdate }));
const mockTxGet = vi.fn().mockResolvedValue({ data: () => undefined });
const mockTx = { get: mockTxGet, set: vi.fn(), update: vi.fn() };
const mockRunTransaction = vi.fn((cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx));
const mockFirestore = vi.fn(() => ({ doc: mockDocRef, runTransaction: mockRunTransaction }));

vi.mock('firebase-admin', () => ({
  default: {
    initializeApp: vi.fn(),
    firestore: mockFirestore,
  },
  initializeApp: vi.fn(),
  firestore: mockFirestore,
}));

// ── Mock firebase-functions/v2/https ─────────────────────────────────────────
// onCall is mocked to return the inner handler directly so tests can call it.

vi.mock('firebase-functions/v2/https', () => ({
  onCall: (_opts: unknown, handler: Function) => handler,
  onRequest: (_opts: unknown, handler: Function) => handler,
  HttpsError: class HttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = 'HttpsError';
    }
  },
}));

// ── Mock firebase-functions/v2/firestore ─────────────────────────────────────

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentCreated: vi.fn((_opts: unknown, handler: Function) => handler),
  onDocumentUpdated: vi.fn((_opts: unknown, handler: Function) => handler),
}));

// ── Mock firebase-functions/v2/scheduler ─────────────────────────────────────

vi.mock('firebase-functions/v2/scheduler', () => ({
  onSchedule: vi.fn((_opts: unknown, handler: Function) => handler),
}));

// ── Mock firebase-functions/params ───────────────────────────────────────────

vi.mock('firebase-functions/params', () => ({
  defineSecret: (name: string) => ({
    value: () => `mock-${name}`,
    name,
  }),
}));

// ── Mock nodemailer ───────────────────────────────────────────────────────────

vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: vi.fn() })) },
  createTransport: vi.fn(() => ({ sendMail: vi.fn() })),
}));

// ── Mock @anthropic-ai/sdk ────────────────────────────────────────────────────

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({})),
}));

// ── Mock twilio ───────────────────────────────────────────────────────────────

vi.mock('twilio', () => ({
  default: vi.fn(() => ({})),
}));

// ── Global fetch mock ─────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ── Import the handler under test ─────────────────────────────────────────────
// Because onCall is mocked to return the handler directly, geocodeVenueAddress
// IS the async handler function after import.

const { geocodeVenueAddress } = await import('./index');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a mock CallableRequest.
 * `uid` is the authenticated caller's uid (pass null for unauthenticated).
 */
function makeRequest(uid: string | null, data: Record<string, unknown>) {
  return {
    auth: uid ? { uid } : undefined,
    data,
  };
}

function nominatimOk(results: Array<{ lat: string; lon: string }>) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(results),
  };
}

function nominatimHttpError(status: number) {
  return { ok: false, status, json: () => Promise.resolve([]) };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('geocodeVenueAddress — validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws invalid-argument when address is missing', async () => {
    const req = makeRequest('user-1', { venueId: 'v1', ownerUid: 'user-1' });
    await expect(geocodeVenueAddress(req as any)).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('throws invalid-argument when address is empty string', async () => {
    const req = makeRequest('user-1', { venueId: 'v1', ownerUid: 'user-1', address: '' });
    await expect(geocodeVenueAddress(req as any)).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('throws invalid-argument when address exceeds 500 characters', async () => {
    const longAddress = 'A'.repeat(501);
    const req = makeRequest('user-1', { venueId: 'v1', ownerUid: 'user-1', address: longAddress });
    await expect(geocodeVenueAddress(req as any)).rejects.toMatchObject({
      code: 'invalid-argument',
      message: expect.stringContaining('500'),
    });
  });

  it('accepts an address of exactly 500 characters without throwing invalid-argument', async () => {
    const address = 'A'.repeat(500);
    mockFetch.mockResolvedValue(nominatimOk([]));
    const req = makeRequest('user-1', { venueId: 'v1', ownerUid: 'user-1', address });
    // Should not throw invalid-argument — Nominatim returns no results so success is false
    const result = await geocodeVenueAddress(req as any);
    expect(result).toEqual({ success: false });
  });
});

describe('geocodeVenueAddress — success path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes lat/lng to Firestore and returns success when Nominatim returns a result', async () => {
    mockFetch.mockResolvedValue(nominatimOk([{ lat: '51.5', lon: '-0.1' }]));

    const req = makeRequest('user-1', { venueId: 'venue-1', ownerUid: 'user-1', address: '1 Test St, London' });
    const result = await geocodeVenueAddress(req as any);

    expect(result).toEqual({ success: true, lat: 51.5, lng: -0.1 });
    expect(mockDocRef).toHaveBeenCalledWith('users/user-1/venues/venue-1');
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 51.5, lng: -0.1, updatedAt: expect.any(String) }),
    );
  });

  it('parses lat/lng as floats from string values', async () => {
    mockFetch.mockResolvedValue(nominatimOk([{ lat: '53.4808', lon: '-2.2426' }]));

    const req = makeRequest('user-2', { venueId: 'v2', ownerUid: 'user-2', address: 'Manchester, UK' });
    const result = await geocodeVenueAddress(req as any);

    expect(result).toMatchObject({ success: true, lat: 53.4808, lng: -2.2426 });
  });
});

describe('geocodeVenueAddress — no results', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns { success: false } without writing to Firestore when Nominatim returns []', async () => {
    mockFetch.mockResolvedValue(nominatimOk([]));

    const req = makeRequest('user-1', { venueId: 'v1', ownerUid: 'user-1', address: 'Nowhere Land' });
    const result = await geocodeVenueAddress(req as any);

    expect(result).toEqual({ success: false });
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe('geocodeVenueAddress — HTTP error', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns { success: false } when Nominatim returns a non-OK HTTP status', async () => {
    mockFetch.mockResolvedValue(nominatimHttpError(429));

    const req = makeRequest('user-1', { venueId: 'v1', ownerUid: 'user-1', address: '1 Test St' });
    const result = await geocodeVenueAddress(req as any);

    expect(result).toEqual({ success: false });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns { success: false } and does not crash when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('Network failure'));

    const req = makeRequest('user-1', { venueId: 'v1', ownerUid: 'user-1', address: '1 Test St' });
    const result = await geocodeVenueAddress(req as any);

    expect(result).toEqual({ success: false });
  });

  it('returns { success: false } and does not crash when fetch times out (AbortError)', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    mockFetch.mockRejectedValue(abortError);

    const req = makeRequest('user-1', { venueId: 'v1', ownerUid: 'user-1', address: '1 Test St' });
    const result = await geocodeVenueAddress(req as any);

    expect(result).toEqual({ success: false });
  });
});
