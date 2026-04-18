/**
 * Unit tests for teamColors.ts
 *
 * Key assertions:
 *  1. Every hex in the FE TEAM_COLOR_PALETTE is accepted (the original bug:
 *     mixed-case values like '#DC143C' were rejected).
 *  2. Values not in the palette are rejected.
 *  3. Comparison is case-insensitive in both directions.
 */

import { describe, it, expect } from 'vitest';
import { isAllowedTeamColor, ALLOWED_TEAM_COLORS } from './teamColors';

/**
 * TEAM_COLOR_PALETTE duplicated from src/constants/index.ts.
 *
 * This is intentional: the test proves that every FE palette entry is accepted
 * by the CF validator. If the FE palette changes, update this list AND
 * teamColors.ts together.
 */
const FE_TEAM_COLOR_PALETTE_FLAT: string[] = [
  // Row 1 — Reds & Pinks
  '#DC143C', '#E53E3E', '#FF6347', '#FF7F7F', '#E91E8C', '#FF1493',
  // Row 2 — Oranges & Yellows
  '#CC5500', '#F97316', '#F59E0B', '#EAB308', '#FBBF24', '#84CC16',
  // Row 3 — Greens
  '#15803D', '#22C55E', '#10B981', '#0D9488', '#00A86B', '#708238',
  // Row 4 — Blues
  '#1E3A5F', '#2563EB', '#0047AB', '#0EA5E9', '#56A0D3', '#818CF8',
  // Row 5 — Purples & Maroons
  '#800000', '#800020', '#7C3AED', '#8B5CF6', '#4F46E5', '#8E4585',
  // Row 6 — Neutrals & Specialty
  '#111111', '#374151', '#64748B', '#9CA3AF', '#92400E', '#134E4A',
];

describe('isAllowedTeamColor', () => {
  describe('accepts every color in the FE TEAM_COLOR_PALETTE (case-insensitive)', () => {
    it.each(FE_TEAM_COLOR_PALETTE_FLAT)(
      'accepts %s',
      (hex) => {
        expect(isAllowedTeamColor(hex)).toBe(true);
      },
    );
  });

  describe('case-insensitive matching', () => {
    it('accepts uppercase input for a lowercase-stored color', () => {
      // '#dc143c' is stored lowercase; FE sends '#DC143C'
      expect(isAllowedTeamColor('#DC143C')).toBe(true);
    });

    it('accepts lowercase input', () => {
      expect(isAllowedTeamColor('#dc143c')).toBe(true);
    });

    it('accepts mixed-case input', () => {
      expect(isAllowedTeamColor('#Dc143C')).toBe(true);
    });
  });

  describe('rejects colors not in the palette', () => {
    it('rejects a completely unknown hex', () => {
      expect(isAllowedTeamColor('#000001')).toBe(false);
    });

    it('rejects a script-injection string', () => {
      expect(isAllowedTeamColor('<script>alert(1)</script>')).toBe(false);
    });

    it('rejects an empty string', () => {
      expect(isAllowedTeamColor('')).toBe(false);
    });

    it('rejects the old Tailwind-500 blue that is no longer in the palette', () => {
      // '#3b82f6' was in the old 12-color set but is not in TEAM_COLOR_PALETTE
      expect(isAllowedTeamColor('#3b82f6')).toBe(false);
    });
  });

  describe('ALLOWED_TEAM_COLORS list integrity', () => {
    it('contains exactly 36 colors (6 rows × 6 columns)', () => {
      expect(ALLOWED_TEAM_COLORS.length).toBe(36);
    });

    it('every entry is a valid lowercase hex color', () => {
      const hexPattern = /^#[0-9a-f]{6}$/;
      for (const color of ALLOWED_TEAM_COLORS) {
        expect(color).toMatch(hexPattern);
      }
    });

    it('has no duplicates', () => {
      const unique = new Set(ALLOWED_TEAM_COLORS);
      expect(unique.size).toBe(ALLOWED_TEAM_COLORS.length);
    });
  });
});
