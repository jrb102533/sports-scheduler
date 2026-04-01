import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Menu } from 'lucide-react';
import { useNotificationStore } from '@/store/useNotificationStore';
import { useAuthStore } from '@/store/useAuthStore';

interface TopBarProps {
  greeting: string;
  pageTitle: string;
  onMenuClick: () => void;
}

export function TopBar({ greeting, pageTitle, onMenuClick }: TopBarProps) {
  const { notifications, setPanelOpen } = useNotificationStore();
  const { profile, logout } = useAuthStore();
  const navigate = useNavigate();
  const unread = notifications.filter(n => !n.isRead).length;

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const firstName = profile?.displayName?.split(' ')[0] ?? '';
  const initial = profile?.displayName?.charAt(0).toUpperCase() ?? '';

  // Close on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    function handlePointerDown(e: PointerEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [dropdownOpen]);

  // Keyboard navigation: Escape closes, arrows move focus
  function handleMenuKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    if (!items || items.length === 0) return;
    const focused = document.activeElement as HTMLElement;
    const currentIndex = Array.from(items).indexOf(focused);

    if (e.key === 'Escape') {
      e.preventDefault();
      setDropdownOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = items[currentIndex + 1] ?? items[0];
      next?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = items[currentIndex - 1] ?? items[items.length - 1];
      prev?.focus();
    }
  }

  // Focus first menu item on open
  useEffect(() => {
    if (!dropdownOpen) return;
    const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
    first?.focus();
  }, [dropdownOpen]);

  async function handleSignOut() {
    setDropdownOpen(false);
    await logout();
  }

  return (
    <header className="border-b border-gray-200 bg-white flex items-center justify-between px-4 sm:px-6 flex-shrink-0 h-14">
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onMenuClick}
          className="lg:hidden p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors flex-shrink-0"
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
        {(greeting || pageTitle) && (
          <div className="min-w-0">
            {greeting && <p className="text-base sm:text-lg font-semibold text-gray-900 truncate leading-tight">{greeting}</p>}
            {pageTitle && (
              <p className={`truncate leading-tight ${greeting ? 'text-xs text-gray-400' : 'text-base sm:text-lg font-semibold text-gray-900'}`}>{pageTitle}</p>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Notification bell */}
        <button
          onClick={() => setPanelOpen(true)}
          className="relative p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
          aria-label="Open notifications"
        >
          <Bell size={20} />
          {unread > 0 && (
            <span className="absolute top-1 right-1 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center leading-none">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>

        {/* Avatar chip */}
        {profile && (
          <div className="relative">
            <button
              ref={triggerRef}
              onClick={() => setDropdownOpen(o => !o)}
              aria-haspopup="menu"
              aria-expanded={dropdownOpen}
              aria-label="Account menu"
              className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-gray-100 transition-colors"
            >
              <span className="hidden sm:block text-sm font-medium text-gray-700">{firstName}</span>
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
                style={{ backgroundColor: '#f97316' }}
                aria-hidden="true"
              >
                {initial}
              </div>
            </button>

            {dropdownOpen && (
              <div
                ref={menuRef}
                role="menu"
                aria-label="Account menu"
                onKeyDown={handleMenuKeyDown}
                className="absolute right-0 top-full mt-2 z-50 bg-white rounded-xl shadow-lg border border-gray-200 py-1"
                style={{ minWidth: '200px' }}
              >
                {/* Header row — non-clickable */}
                <div className="px-4 py-2.5">
                  <p className="font-semibold text-sm text-gray-900 truncate">{profile.displayName}</p>
                  <p className="text-xs text-gray-500 capitalize mt-0.5">{profile.role.replace('_', ' ')}</p>
                </div>

                <div className="border-t border-gray-100 my-1" />

                <button
                  role="menuitem"
                  onClick={() => { setDropdownOpen(false); navigate('/profile'); }}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  My Profile
                </button>
                <button
                  role="menuitem"
                  onClick={() => { setDropdownOpen(false); navigate('/settings'); }}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Settings
                </button>

                <div className="border-t border-gray-100 my-1" />

                <button
                  role="menuitem"
                  onClick={handleSignOut}
                  className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-gray-50 transition-colors"
                >
                  Sign Out
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
