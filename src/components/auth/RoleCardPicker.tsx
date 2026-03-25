import { Check, Users, Heart, Trophy, Layers, X } from 'lucide-react';
import { clsx } from 'clsx';
import type { UserRole } from '@/types';

interface RoleDefinition {
  role: UserRole;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  description: string;
}

export const ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    role: 'coach',
    icon: Users,
    title: 'Coach',
    description: "I manage a team's roster, schedule, and attendance",
  },
  {
    role: 'parent',
    icon: Heart,
    title: 'Parent',
    description: "I follow my child's team schedule",
  },
  {
    role: 'player',
    icon: Trophy,
    title: 'Player',
    description: 'I\'m on a team and view my schedule',
  },
  {
    role: 'league_manager',
    icon: Layers,
    title: 'League Manager',
    description: 'I manage schedules across multiple teams',
  },
];

interface RoleCardPickerProps {
  /** The currently selected primary role */
  primaryRole: UserRole;
  /** Additional (secondary) roles selected */
  additionalRoles: UserRole[];
  /** Called when user clicks a card to set it as primary */
  onPrimaryChange: (role: UserRole) => void;
  /** Called when user adds a secondary role via the pill row */
  onAddSecondary: (role: UserRole) => void;
  /** Called when user removes a secondary role badge */
  onRemoveSecondary: (role: UserRole) => void;
}

export function RoleCardPicker({
  primaryRole,
  additionalRoles,
  onPrimaryChange,
  onAddSecondary,
  onRemoveSecondary,
}: RoleCardPickerProps) {
  const selectedRoles = new Set<UserRole>([primaryRole, ...additionalRoles]);
  const availableForSecondary = ROLE_DEFINITIONS.filter(d => !selectedRoles.has(d.role));

  return (
    <div className="space-y-4">
      {/* Primary role card grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {ROLE_DEFINITIONS.map(({ role, icon: Icon, title, description }) => {
          const isSelected = role === primaryRole;
          return (
            <button
              key={role}
              type="button"
              onClick={() => onPrimaryChange(role)}
              className={clsx(
                'relative text-left rounded-xl p-4 transition-all duration-150',
                isSelected
                  ? 'border-2 border-[#f97316] bg-orange-50'
                  : 'border border-gray-200 bg-white hover:shadow-sm hover:border-gray-300',
              )}
            >
              {/* Checkmark badge */}
              {isSelected && (
                <span className="absolute top-2 right-2 w-5 h-5 rounded-full bg-[#f97316] flex items-center justify-center">
                  <Check size={11} className="text-white" strokeWidth={3} />
                </span>
              )}

              <Icon size={24} className={clsx('mb-2', isSelected ? 'text-[#f97316]' : 'text-gray-500')} />
              <p className={clsx('font-semibold text-sm leading-tight', isSelected ? 'text-gray-900' : 'text-gray-800')}>
                {title}
              </p>
              <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{description}</p>
            </button>
          );
        })}
      </div>

      {/* Secondary roles section */}
      <div className="space-y-2">
        {/* Existing secondary role badges */}
        {additionalRoles.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {additionalRoles.map(r => {
              const def = ROLE_DEFINITIONS.find(d => d.role === r);
              if (!def) return null;
              const Icon = def.icon;
              return (
                <span
                  key={r}
                  className="inline-flex items-center gap-1.5 bg-orange-50 border border-orange-200 text-orange-700 rounded-full pl-2.5 pr-1.5 py-1 text-xs font-medium"
                >
                  <Icon size={12} />
                  {def.title}
                  <button
                    type="button"
                    onClick={() => onRemoveSecondary(r)}
                    className="ml-0.5 rounded-full text-orange-400 hover:text-orange-700 hover:bg-orange-100 p-0.5 transition-colors"
                    aria-label={`Remove ${def.title}`}
                  >
                    <X size={10} />
                  </button>
                </span>
              );
            })}
          </div>
        )}

        {/* Add another role link + available role pills */}
        {availableForSecondary.length > 0 && (
          <AddSecondaryRow roles={availableForSecondary} onAdd={onAddSecondary} />
        )}
      </div>
    </div>
  );
}

/** Expandable "Add another role" row with selectable role pills */
function AddSecondaryRow({
  roles,
  onAdd,
}: {
  roles: RoleDefinition[];
  onAdd: (role: UserRole) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-gray-400 font-medium">+ Add another role:</span>
      {roles.map(({ role, icon: Icon, title }) => (
        <button
          key={role}
          type="button"
          onClick={() => onAdd(role)}
          className="inline-flex items-center gap-1.5 border border-gray-200 bg-white text-gray-600 rounded-full px-2.5 py-1 text-xs font-medium hover:border-gray-400 hover:bg-gray-50 transition-colors"
        >
          <Icon size={12} />
          {title}
        </button>
      ))}
    </div>
  );
}
