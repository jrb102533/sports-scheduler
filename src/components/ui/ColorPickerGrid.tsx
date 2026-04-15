import { useState, useRef, useEffect } from 'react';
import { TEAM_COLOR_PALETTE } from '@/constants';

interface ColorPickerGridProps {
  value: string;
  onChange: (color: string) => void;
  disabled?: boolean;
}

export function ColorPickerGrid({ value, onChange, disabled = false }: ColorPickerGridProps) {
  const [open, setOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (sheetRef.current && !sheetRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const selectedEntry = TEAM_COLOR_PALETTE.flat().find(c => c.hex === value);
  const label = selectedEntry?.name ?? 'Custom';

  return (
    <div className="relative">
      {/* Trigger */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-3 px-3 py-2 rounded-xl border border-gray-200 bg-white hover:border-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label={`Team color: ${label}. Tap to change.`}
      >
        <span
          className="w-7 h-7 rounded-full flex-shrink-0 shadow-sm"
          style={{ backgroundColor: value }}
        />
        <span className="text-sm text-gray-700">{label}</span>
        <svg className="w-4 h-4 text-gray-400 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Bottom-sheet overlay */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          {/* Scrim */}
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />

          {/* Sheet */}
          <div
            ref={sheetRef}
            className="relative w-full sm:w-auto sm:max-w-sm bg-white rounded-t-2xl sm:rounded-2xl shadow-xl px-5 pt-4 pb-8 sm:pb-5 z-10"
          >
            {/* Drag handle (mobile) */}
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4 sm:hidden" />

            <p className="text-sm font-semibold text-gray-900 mb-3">Team Color</p>

            {/* Current color preview */}
            <div
              className="w-full h-10 rounded-xl mb-4 flex items-center justify-center"
              style={{ backgroundColor: value }}
            >
              <span
                className="text-sm font-medium px-3"
                style={{ color: getContrastColor(value) }}
              >
                {label}
              </span>
            </div>

            {/* Swatch grid */}
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(6, 44px)' }}>
              {TEAM_COLOR_PALETTE.flat().map(({ hex, name }) => {
                const isSelected = hex === value;
                return (
                  <button
                    key={hex}
                    type="button"
                    aria-label={name}
                    aria-pressed={isSelected}
                    onClick={() => { onChange(hex); setOpen(false); }}
                    className="w-11 h-11 rounded-full transition-transform focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 hover:scale-110"
                    style={{
                      backgroundColor: hex,
                      boxShadow: isSelected
                        ? `0 0 0 3px #ffffff, 0 0 0 5px ${hex}`
                        : undefined,
                      transform: isSelected ? 'scale(1.1)' : undefined,
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Returns white or black depending on which has better contrast against the given hex. */
function getContrastColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // Relative luminance (WCAG formula)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#111111' : '#ffffff';
}
