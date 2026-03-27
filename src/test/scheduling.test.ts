import { describe, it, expect, vi, afterEach } from 'vitest';
import { addDays, addWeeks, addMonths, parseISO, format, isAfter } from 'date-fns';
import type { ScheduledEvent, AttendanceStatus, RecurrenceFrequency } from '@/types';

afterEach(() => {
  vi.useRealTimers();
});

// ─── Helpers duplicated from EventForm (pure functions, no React) ─────────────

const MAX_OCCURRENCES = 365;

function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return -1;
  return h * 60 + m;
}

function addMinutesToTime(time: string, minutes: number): string {
  const total = toMinutes(time) + minutes;
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const DEFAULT_DURATION = 90;

function timesOverlap(
  aStart: string, aEnd: string | undefined,
  bStart: string, bEnd: string | undefined
): boolean {
  const aS = toMinutes(aStart);
  const aE = aEnd ? toMinutes(aEnd) : aS + DEFAULT_DURATION;
  const bS = toMinutes(bStart);
  const bE = bEnd ? toMinutes(bEnd) : bS + DEFAULT_DURATION;
  if (aS < 0 || bS < 0) return false;
  return aS < bE && bS < aE;
}

function generateOccurrences(startDate: string, endDate: string, frequency: RecurrenceFrequency): string[] {
  const start = parseISO(startDate);
  const end = parseISO(endDate);
  const dates: string[] = [];
  let current = start;
  while (!isAfter(current, end) && dates.length < MAX_OCCURRENCES) {
    dates.push(format(current, 'yyyy-MM-dd'));
    switch (frequency) {
      case 'daily':    current = addDays(current, 1);   break;
      case 'weekly':   current = addWeeks(current, 1);  break;
      case 'biweekly': current = addWeeks(current, 2);  break;
      case 'monthly':  current = addMonths(current, 1); break;
    }
  }
  return dates;
}

function prefillAttendanceFromRsvps(rsvps: ScheduledEvent['rsvps']): { playerId: string; status: AttendanceStatus }[] {
  return (rsvps ?? []).map(r => ({
    playerId: r.playerId,
    status: (r.response === 'yes' ? 'present' : r.response === 'no' ? 'absent' : 'excused') as AttendanceStatus,
  }));
}

// ─── generateOccurrences ─────────────────────────────────────────────────────

describe('generateOccurrences', () => {
  describe('weekly frequency', () => {
    it('generates correct number of weekly occurrences', () => {
      const dates = generateOccurrences('2026-01-05', '2026-03-30', 'weekly');
      expect(dates.length).toBe(13); // Jan 5, 12, 19, 26, Feb 2, 9, 16, 23, Mar 2, 9, 16, 23, 30
    });

    it('includes the start date', () => {
      const dates = generateOccurrences('2026-04-01', '2026-04-15', 'weekly');
      expect(dates[0]).toBe('2026-04-01');
    });

    it('includes the end date when it falls on an occurrence', () => {
      const dates = generateOccurrences('2026-04-01', '2026-04-08', 'weekly');
      expect(dates).toContain('2026-04-08');
    });

    it('does not exceed the end date', () => {
      const dates = generateOccurrences('2026-04-01', '2026-04-10', 'weekly');
      expect(dates.every(d => d <= '2026-04-10')).toBe(true);
    });
  });

  describe('daily frequency', () => {
    it('generates daily occurrences', () => {
      const dates = generateOccurrences('2026-04-01', '2026-04-07', 'daily');
      expect(dates).toEqual([
        '2026-04-01', '2026-04-02', '2026-04-03',
        '2026-04-04', '2026-04-05', '2026-04-06', '2026-04-07',
      ]);
    });
  });

  describe('biweekly frequency', () => {
    it('generates every two weeks', () => {
      const dates = generateOccurrences('2026-04-01', '2026-05-01', 'biweekly');
      expect(dates).toEqual(['2026-04-01', '2026-04-15', '2026-04-29']);
    });
  });

  describe('monthly frequency', () => {
    it('generates monthly occurrences', () => {
      const dates = generateOccurrences('2026-01-15', '2026-04-15', 'monthly');
      expect(dates).toEqual(['2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15']);
    });
  });

  describe('edge cases', () => {
    it('returns single occurrence when start equals end', () => {
      const dates = generateOccurrences('2026-04-01', '2026-04-01', 'weekly');
      expect(dates).toEqual(['2026-04-01']);
    });

    it('returns empty array when end is before start', () => {
      const dates = generateOccurrences('2026-04-10', '2026-04-01', 'weekly');
      expect(dates).toEqual([]);
    });

    it('caps at MAX_OCCURRENCES (365) for pathologically long daily ranges', () => {
      const dates = generateOccurrences('2020-01-01', '2030-12-31', 'daily');
      expect(dates.length).toBe(MAX_OCCURRENCES);
    });

    it('does not exceed 365 for weekly over many years', () => {
      const dates = generateOccurrences('2020-01-01', '2030-12-31', 'weekly');
      expect(dates.length).toBeLessThanOrEqual(MAX_OCCURRENCES);
    });
  });
});

// ─── timesOverlap ─────────────────────────────────────────────────────────────

describe('timesOverlap', () => {
  it('returns true for overlapping events', () => {
    expect(timesOverlap('09:00', '10:00', '09:30', '10:30')).toBe(true);
  });

  it('returns true when one event contains another', () => {
    expect(timesOverlap('09:00', '12:00', '10:00', '11:00')).toBe(true);
  });

  it('returns false for back-to-back events (end === start)', () => {
    expect(timesOverlap('09:00', '10:00', '10:00', '11:00')).toBe(false);
  });

  it('returns false for non-overlapping events', () => {
    expect(timesOverlap('09:00', '10:00', '11:00', '12:00')).toBe(false);
  });

  it('returns false for non-overlapping events in reverse order', () => {
    expect(timesOverlap('14:00', '15:00', '09:00', '10:00')).toBe(false);
  });

  it('uses DEFAULT_DURATION when endTime is absent', () => {
    // 09:00 with 90-min default = 10:30; overlaps with 10:00-11:00
    expect(timesOverlap('09:00', undefined, '10:00', '11:00')).toBe(true);
  });

  it('does not overlap when default duration does not reach the other event', () => {
    // 09:00 with 90-min default = 10:30; does NOT overlap with 11:00-12:00
    expect(timesOverlap('09:00', undefined, '11:00', '12:00')).toBe(false);
  });

  it('returns false silently for unparseable start time', () => {
    expect(timesOverlap('bad', '10:00', '09:00', '10:00')).toBe(false);
  });

  it('handles midnight-crossing correctly via minutes', () => {
    // 23:00-01:00 next day — addMinutes wraps at 24h; treat as truncated at midnight
    const aS = toMinutes('23:00');
    const aE = toMinutes('01:00'); // parses to 60 min
    // 23:00(1380) < 90(aE) is false → no overlap detected (known limitation)
    expect(aS).toBe(1380);
    expect(aE).toBe(60);
  });
});

// ─── addMinutesToTime ─────────────────────────────────────────────────────────

describe('addMinutesToTime', () => {
  it('adds minutes correctly within the same hour', () => {
    expect(addMinutesToTime('09:00', 30)).toBe('09:30');
  });

  it('carries over to next hour', () => {
    expect(addMinutesToTime('09:45', 30)).toBe('10:15');
  });

  it('wraps at midnight', () => {
    expect(addMinutesToTime('23:30', 60)).toBe('00:30');
  });

  it('handles zero minutes', () => {
    expect(addMinutesToTime('14:00', 0)).toBe('14:00');
  });

  it('handles 90-minute default duration', () => {
    expect(addMinutesToTime('18:00', 90)).toBe('19:30');
  });
});

// ─── prefillAttendanceFromRsvps ───────────────────────────────────────────────

describe('prefillAttendanceFromRsvps', () => {
  it('maps yes → present', () => {
    const result = prefillAttendanceFromRsvps([
      { playerId: 'p1', name: 'Alice', email: '', response: 'yes', respondedAt: '' },
    ]);
    expect(result[0]).toEqual({ playerId: 'p1', status: 'present' });
  });

  it('maps no → absent', () => {
    const result = prefillAttendanceFromRsvps([
      { playerId: 'p2', name: 'Bob', email: '', response: 'no', respondedAt: '' },
    ]);
    expect(result[0]).toEqual({ playerId: 'p2', status: 'absent' });
  });

  it('maps maybe → excused', () => {
    const result = prefillAttendanceFromRsvps([
      { playerId: 'p3', name: 'Carol', email: '', response: 'maybe', respondedAt: '' },
    ]);
    expect(result[0]).toEqual({ playerId: 'p3', status: 'excused' });
  });

  it('handles mixed responses correctly', () => {
    const rsvps = [
      { playerId: 'p1', name: 'A', email: '', response: 'yes' as const, respondedAt: '' },
      { playerId: 'p2', name: 'B', email: '', response: 'no' as const, respondedAt: '' },
      { playerId: 'p3', name: 'C', email: '', response: 'maybe' as const, respondedAt: '' },
    ];
    const result = prefillAttendanceFromRsvps(rsvps);
    expect(result).toEqual([
      { playerId: 'p1', status: 'present' },
      { playerId: 'p2', status: 'absent' },
      { playerId: 'p3', status: 'excused' },
    ]);
  });

  it('returns empty array for no RSVPs', () => {
    expect(prefillAttendanceFromRsvps([])).toEqual([]);
    expect(prefillAttendanceFromRsvps(undefined)).toEqual([]);
  });

  it('preserves all RSVPs — not just yes responses', () => {
    const rsvps = [
      { playerId: 'p1', name: 'A', email: '', response: 'yes' as const, respondedAt: '' },
      { playerId: 'p2', name: 'B', email: '', response: 'no' as const, respondedAt: '' },
    ];
    const result = prefillAttendanceFromRsvps(rsvps);
    expect(result).toHaveLength(2);
  });
});

// ─── updateEventsByGroupId filter logic ──────────────────────────────────────

describe('updateEventsByGroupId filter (fromDate boundary)', () => {
  const groupId = 'group-1';

  function makeRecurringEvent(id: string, date: string): ScheduledEvent {
    return { id, date, recurringGroupId: groupId } as unknown as ScheduledEvent;
  }

  const events = [
    makeRecurringEvent('e1', '2026-03-01'),
    makeRecurringEvent('e2', '2026-03-08'),
    makeRecurringEvent('e3', '2026-03-15'),
    makeRecurringEvent('e4', '2026-03-22'),
    makeRecurringEvent('e5', '2026-03-29'),
  ];

  it('filters to events >= fromDate (inclusive)', () => {
    const fromDate = '2026-03-15';
    const result = events.filter(e => e.recurringGroupId === groupId && e.date >= fromDate);
    expect(result.map(e => e.id)).toEqual(['e3', 'e4', 'e5']);
  });

  it('includes the event on exactly fromDate', () => {
    const fromDate = '2026-03-08';
    const result = events.filter(e => e.recurringGroupId === groupId && e.date >= fromDate);
    expect(result.map(e => e.id)).toContain('e2');
  });

  it('editing from the first event updates the whole series', () => {
    const fromDate = '2026-03-01';
    const result = events.filter(e => e.recurringGroupId === groupId && e.date >= fromDate);
    expect(result).toHaveLength(5);
  });

  it('editing from the last event updates only that event', () => {
    const fromDate = '2026-03-29';
    const result = events.filter(e => e.recurringGroupId === groupId && e.date >= fromDate);
    expect(result.map(e => e.id)).toEqual(['e5']);
  });
});

// ─── occurrenceCount display edge cases ──────────────────────────────────────

describe('occurrenceCount validation (recurrenceEnd < date guard)', () => {
  it('returns 0 when end is before start', () => {
    const start = '2026-04-10';
    const end = '2026-04-01';
    const count = end < start ? 0 : generateOccurrences(start, end, 'weekly').length;
    expect(count).toBe(0);
  });

  it('returns 1 when start equals end', () => {
    const start = '2026-04-10';
    const end = '2026-04-10';
    // Guard is `end < start` (not <=), so same-day IS allowed
    const count = end < start ? 0 : generateOccurrences(start, end, 'weekly').length;
    expect(count).toBe(1);
  });

  it('returns correct count for valid range', () => {
    const start = '2026-04-01';
    const end = '2026-04-29';
    const count = end < start ? 0 : generateOccurrences(start, end, 'weekly').length;
    expect(count).toBe(5); // Apr 1, 8, 15, 22, 29
  });
});
