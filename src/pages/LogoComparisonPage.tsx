import type { ReactNode } from 'react';
import { LogoOptionA } from '@/components/brand/LogoOptionA';
import { LogoOptionB } from '@/components/brand/LogoOptionB';
import { LogoOptionC } from '@/components/brand/LogoOptionC';
import { ClipboardWordmark } from '@/components/brand/ClipboardWordmark';

type LogoVariant = 'light' | 'dark';

interface LogoComponent {
  component: React.ComponentType<{ size: number; variant: LogoVariant }>;
  label: string;
}

const LOGOS: LogoComponent[] = [
  { component: LogoOptionA, label: 'Option A' },
  { component: LogoOptionB, label: 'Option B' },
  { component: LogoOptionC, label: 'Option C' },
  { component: ClipboardWordmark, label: 'Option D — Clipboard Wordmark' },
];

const NAVY = '#1B3A6B';

interface LogoCardProps {
  label: string;
  background: string;
  children: ReactNode;
  cardWidth?: string;
}

function LogoCard({ label, background, children, cardWidth = 'w-72' }: LogoCardProps) {
  return (
    <div className={`flex flex-col items-center gap-3 ${cardWidth}`}>
      <div
        className="w-full flex items-center justify-center rounded-xl p-8"
        style={{ backgroundColor: background }}
      >
        {children}
      </div>
      <span className="text-sm font-medium text-gray-600">{label}</span>
    </div>
  );
}

interface SectionProps {
  title: string;
  children: ReactNode;
}

function Section({ title, children }: SectionProps) {
  return (
    <section className="mb-14">
      <h2 className="text-base font-semibold text-gray-500 uppercase tracking-widest mb-6 border-b border-gray-200 pb-2">
        {title}
      </h2>
      <div className="flex flex-wrap gap-8 items-start">
        {children}
      </div>
    </section>
  );
}

export function LogoComparisonPage() {
  return (
    <main className="min-h-screen bg-gray-50 px-8 py-10">
      <div className="max-w-5xl mx-auto">
        <header className="mb-12">
          <p className="text-xs font-semibold uppercase tracking-widest text-orange-500 mb-1">
            Dev Only
          </p>
          <h1 className="text-3xl font-bold text-gray-900">
            Logo Comparison — Design Review
          </h1>
          <p className="mt-2 text-gray-500 text-sm">
            Three SVG logo options across multiple usage contexts. No images, no external fonts.
          </p>
        </header>

        <Section title="On Dark Background (Sidebar)">
          {LOGOS.map(({ component: Logo, label }) => (
            <LogoCard key={label} label={label} background={NAVY}>
              <Logo size={200} variant="light" />
            </LogoCard>
          ))}
        </Section>

        <Section title="On White Background">
          {LOGOS.map(({ component: Logo, label }) => (
            <LogoCard key={label} label={label} background="#FFFFFF">
              <Logo size={200} variant="dark" />
            </LogoCard>
          ))}
        </Section>

        <Section title="Small Scale (Favicon / App Icon)">
          {LOGOS.map(({ component: Logo, label }) => (
            <LogoCard key={label} label={label} background="#FFFFFF" cardWidth="w-32">
              <Logo size={32} variant="dark" />
            </LogoCard>
          ))}
        </Section>

        <Section title="TopBar Scale">
          <div className="flex flex-col gap-4 w-full">
            {LOGOS.map(({ component: Logo, label }) => (
              <div key={label} className="flex flex-col gap-1">
                <span className="text-xs text-gray-500 font-medium">{label}</span>
                <div className="w-full flex items-center bg-gray-100 px-4 rounded-lg" style={{ height: '52px' }}>
                  <Logo size={120} variant="dark" />
                </div>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </main>
  );
}
