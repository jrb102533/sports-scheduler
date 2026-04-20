import { useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /**
   * When true the panel is fixed to 92 vh and laid out as a flex column.
   * The children wrapper becomes the scrollable grow region; use this for
   * multi-step wizards where content varies in height between steps.
   */
  fixedHeight?: boolean;
}

export function Modal({ open, onClose, title, children, size = 'md', fixedHeight = false }: ModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const widths = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl' };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={`relative bg-white w-full ${widths[size]} ${fixedHeight ? 'h-[92vh] flex flex-col overflow-hidden' : 'max-h-[92vh] overflow-y-auto'} rounded-t-2xl sm:rounded-2xl shadow-xl`}
      >
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 id="modal-title" className="text-base sm:text-lg font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500">
            <X size={18} />
          </button>
        </div>
        <div className={fixedHeight ? 'flex flex-col flex-1 min-h-0 px-4 sm:px-6 overflow-hidden' : 'px-4 sm:px-6 py-4'}>
          {children}
        </div>
      </div>
    </div>
  );
}
