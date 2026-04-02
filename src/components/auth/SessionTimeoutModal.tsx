interface SessionTimeoutModalProps {
  countdown: number;
  onStaySignedIn: () => void;
  onSignOut: () => void;
}

export function SessionTimeoutModal({ countdown, onStaySignedIn, onSignOut }: SessionTimeoutModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative bg-white w-full sm:max-w-sm max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl shadow-xl">
        <div className="px-4 sm:px-6 py-4 border-b border-gray-100">
          <h2 className="text-base sm:text-lg font-semibold text-gray-900">Session Expiring Soon</h2>
        </div>
        <div className="px-4 sm:px-6 py-6 flex flex-col items-center gap-4">
          <div
            className="text-6xl font-bold tabular-nums text-orange-500"
            aria-live="polite"
            aria-atomic="true"
            aria-label={`${countdown} seconds remaining`}
          >
            {countdown}
          </div>
          <p className="text-sm text-gray-600 text-center">
            You've been inactive for 30 minutes. You will be signed out in{' '}
            <span className="font-semibold">{countdown} second{countdown !== 1 ? 's' : ''}</span>.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 w-full pt-2">
            <button
              type="button"
              onClick={onStaySignedIn}
              className="flex-1 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
            >
              Stay Signed In
            </button>
            <button
              type="button"
              onClick={onSignOut}
              className="flex-1 px-4 py-2.5 rounded-lg border border-red-300 text-red-600 text-sm font-semibold hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2 transition-colors"
            >
              Sign Out Now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
