import { WhistleLogo } from '@/components/ui/WhistleLogo';

interface AuthLayoutProps {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
}

export function AuthLayout({ children, title, subtitle }: AuthLayoutProps) {
  return (
    <div className="min-h-screen flex">
      {/* Left panel — brand */}
      <div
        className="hidden lg:flex flex-col justify-between w-96 flex-shrink-0 p-10 text-white"
        style={{ background: 'linear-gradient(160deg, #14532d 0%, #134e4a 60%, #0f3460 100%)' }}
      >
        <div className="flex items-center gap-3">
          <WhistleLogo size={40} />
          <div>
            <span className="font-bold text-lg tracking-tight">First</span>
            <span className="font-medium text-lg tracking-tight text-green-300 ml-1">Whistle</span>
          </div>
        </div>
        <div>
          <p className="text-4xl font-bold leading-tight mb-4">
            Game day<br/>starts here.
          </p>
          <p className="text-green-200 text-sm leading-relaxed">
            Schedule games, track rosters, manage leagues — everything your team needs in one place.
          </p>
        </div>
        <div className="flex gap-6 text-xs text-green-300 opacity-70">
          <span>Schedules</span>
          <span>Rosters</span>
          <span>Standings</span>
          <span>Messaging</span>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center p-6 bg-gray-50">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8 lg:hidden">
            <WhistleLogo size={48} />
            <h1 className="text-xl font-bold text-gray-900 mt-3">First Whistle</h1>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-1">{title}</h2>
          {subtitle && <p className="text-gray-500 text-sm mb-6">{subtitle}</p>}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 sm:p-8">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
