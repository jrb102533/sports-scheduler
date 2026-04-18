/**
 * teamColors.ts — CF-side allowlist for team hex colors.
 *
 * This list must mirror TEAM_COLOR_PALETTE in src/constants/index.ts (FE).
 * It is intentionally duplicated here (no shared package) so the CF bundle
 * has no dependency on the FE source tree.
 *
 * Comparison is always case-insensitive — normalise with .toLowerCase() before
 * checking membership.
 *
 * When the FE palette changes, update both files and extend the unit test in
 * functions/src/teamColors.test.ts to cover any new values.
 */

/** Flat hex array matching TEAM_COLOR_PALETTE.flat().map(c => c.hex). */
export const ALLOWED_TEAM_COLORS: readonly string[] = [
  // Row 1 — Reds & Pinks
  '#dc143c', // Crimson
  '#e53e3e', // Red
  '#ff6347', // Tomato
  '#ff7f7f', // Coral
  '#e91e8c', // Rose
  '#ff1493', // Hot Pink
  // Row 2 — Oranges & Yellows
  '#cc5500', // Burnt Orange
  '#f97316', // Orange
  '#f59e0b', // Amber
  '#eab308', // Gold
  '#fbbf24', // Yellow
  '#84cc16', // Lime
  // Row 3 — Greens
  '#15803d', // Forest
  '#22c55e', // Kelly
  '#10b981', // Emerald
  '#0d9488', // Teal
  '#00a86b', // Jade
  '#708238', // Olive
  // Row 4 — Blues
  '#1e3a5f', // Navy
  '#2563eb', // Royal Blue
  '#0047ab', // Cobalt
  '#0ea5e9', // Sky Blue
  '#56a0d3', // Carolina
  '#818cf8', // Periwinkle
  // Row 5 — Purples & Maroons
  '#800000', // Maroon
  '#800020', // Burgundy
  '#7c3aed', // Purple
  '#8b5cf6', // Violet
  '#4f46e5', // Indigo
  '#8e4585', // Plum
  // Row 6 — Neutrals & Specialty
  '#111111', // Black
  '#374151', // Charcoal
  '#64748b', // Slate
  '#9ca3af', // Silver
  '#92400e', // Brown
  '#134e4a', // Dark Teal
];

/**
 * Returns true when `color` is a palette-approved hex value.
 * Comparison is case-insensitive so the FE can send mixed-case values safely.
 */
export function isAllowedTeamColor(color: string): boolean {
  return ALLOWED_TEAM_COLORS.includes(color.toLowerCase());
}
