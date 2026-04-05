import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface SlideOverProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export function SlideOver({ open, onClose, title, children }: SlideOverProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      document.addEventListener('keydown', handler);
      // Move focus into panel on open
      requestAnimationFrame(() => closeButtonRef.current?.focus());
    } else {
      // Return focus to the element that opened the panel
      previousFocusRef.current?.focus();
    }
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="slide-over-title"
        className="relative flex flex-col w-full sm:w-[440px] bg-white shadow-2xl h-full overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 id="slide-over-title" className="text-base font-semibold text-gray-900">{title}</h2>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Close panel"
            className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
