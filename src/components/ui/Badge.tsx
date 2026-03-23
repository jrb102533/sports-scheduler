import { clsx } from 'clsx';

type BadgeVariant = 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info';

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-gray-100 text-gray-700',
  primary: 'bg-blue-100 text-blue-700',
  success: 'bg-green-100 text-green-700',
  warning: 'bg-yellow-100 text-yellow-700',
  error: 'bg-red-100 text-red-700',
  info: 'bg-indigo-100 text-indigo-700',
};

interface BadgeProps {
  children: React.ReactNode;
  className?: string;
  variant?: BadgeVariant;
}

export function Badge({ children, className, variant = 'default' }: BadgeProps) {
  return (
    <span className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', variantStyles[variant], className)}>
      {children}
    </span>
  );
}
