import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  formatDate,
  formatDateShort,
  formatTime,
  todayISO,
  isUpcoming,
  groupEventsByDate,
  getDaysInMonth,
  formatMonthYear,
  formatDayOfMonth,
  dateToISO,
} from '@/lib/dateUtils';
import type { ScheduledEvent } from '@/types';

afterEach(() => {
  vi.useRealTimers();
});

function makeEvent(id: string, date: string): ScheduledEvent {
  return { id, date } as ScheduledEvent;
}

// ── formatDate ────────────────────────────────────────────────────────────────

describe('formatDate', () => {
  it('formats an ISO date string as "MMM d, yyyy"', () => {
    expect(formatDate('2024-03-15')).toBe('Mar 15, 2024');
  });

  it('handles single-digit days', () => {
    expect(formatDate('2024-01-05')).toBe('Jan 5, 2024');
  });
});

// ── formatDateShort ───────────────────────────────────────────────────────────

describe('formatDateShort', () => {
  it('formats as "MMM d" without the year', () => {
    expect(formatDateShort('2024-07-04')).toBe('Jul 4');
  });
});

// ── formatTime ────────────────────────────────────────────────────────────────

describe('formatTime', () => {
  it('converts 24-hour time to 12-hour AM format', () => {
    expect(formatTime('09:30')).toBe('9:30 AM');
  });

  it('converts noon correctly', () => {
    expect(formatTime('12:00')).toBe('12:00 PM');
  });

  it('converts midnight correctly', () => {
    expect(formatTime('00:00')).toBe('12:00 AM');
  });

  it('converts 18:45 to 6:45 PM', () => {
    expect(formatTime('18:45')).toBe('6:45 PM');
  });
});

// ── todayISO ──────────────────────────────────────────────────────────────────

describe('todayISO', () => {
  it('returns a string matching yyyy-MM-dd format', () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns the current date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00'));
    expect(todayISO()).toBe('2024-06-15');
  });
});

// ── isUpcoming ────────────────────────────────────────────────────────────────

describe('isUpcoming', () => {
  it('returns true for a future event', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-01T12:00:00'));
    expect(isUpcoming(makeEvent('e1', '2024-06-15'))).toBe(true);
  });

  it('returns true for an event on today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00'));
    expect(isUpcoming(makeEvent('e1', '2024-06-15'))).toBe(true);
  });

  it('returns false for a past event', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-20T12:00:00'));
    expect(isUpcoming(makeEvent('e1', '2024-06-15'))).toBe(false);
  });
});

// ── groupEventsByDate ─────────────────────────────────────────────────────────

describe('groupEventsByDate', () => {
  it('returns an empty object for an empty array', () => {
    expect(groupEventsByDate([])).toEqual({});
  });

  it('groups events under their date key', () => {
    const events = [
      makeEvent('e1', '2024-06-01'),
      makeEvent('e2', '2024-06-01'),
      makeEvent('e3', '2024-06-02'),
    ];
    const result = groupEventsByDate(events);
    expect(result['2024-06-01']).toHaveLength(2);
    expect(result['2024-06-02']).toHaveLength(1);
  });

  it('preserves event objects in their groups', () => {
    const e1 = makeEvent('e1', '2024-06-01');
    const result = groupEventsByDate([e1]);
    expect(result['2024-06-01'][0]).toBe(e1);
  });
});

// ── getDaysInMonth ─────────────────────────────────────────────────────────────

describe('getDaysInMonth', () => {
  it('returns 31 days for January', () => {
    expect(getDaysInMonth(2024, 0)).toHaveLength(31);
  });

  it('returns 29 days for February in a leap year', () => {
    expect(getDaysInMonth(2024, 1)).toHaveLength(29);
  });

  it('returns 28 days for February in a non-leap year', () => {
    expect(getDaysInMonth(2023, 1)).toHaveLength(28);
  });

  it('returns 30 days for April', () => {
    expect(getDaysInMonth(2024, 3)).toHaveLength(30);
  });

  it('starts on the first of the month', () => {
    const days = getDaysInMonth(2024, 5); // June
    expect(days[0].getDate()).toBe(1);
    expect(days[0].getMonth()).toBe(5);
  });

  it('ends on the last day of the month', () => {
    const days = getDaysInMonth(2024, 5); // June → 30 days
    expect(days[days.length - 1].getDate()).toBe(30);
  });
});

// ── formatMonthYear ───────────────────────────────────────────────────────────

describe('formatMonthYear', () => {
  it('formats as "MMMM yyyy"', () => {
    expect(formatMonthYear(new Date(2024, 5, 1))).toBe('June 2024');
  });
});

// ── formatDayOfMonth ──────────────────────────────────────────────────────────

describe('formatDayOfMonth', () => {
  it('returns day as a string without leading zero', () => {
    expect(formatDayOfMonth(new Date(2024, 0, 7))).toBe('7');
    expect(formatDayOfMonth(new Date(2024, 0, 15))).toBe('15');
  });
});

// ── dateToISO ─────────────────────────────────────────────────────────────────

describe('dateToISO', () => {
  it('converts a Date to yyyy-MM-dd string', () => {
    expect(dateToISO(new Date(2024, 5, 15))).toBe('2024-06-15');
  });

  it('zero-pads month and day', () => {
    expect(dateToISO(new Date(2024, 0, 5))).toBe('2024-01-05');
  });
});
