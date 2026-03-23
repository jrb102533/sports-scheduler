import { type ButtonHTMLAttributes } from 'react';
import { clsx } from 'clsx';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

export function Button({ variant = 'primary', size = 'md', className, children, ...props }: ButtonProps) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed',
        {
          'bg-[#1B3A6B] hover:bg-[#f97316] text-white focus:ring-[#f97316]': variant === 'primary',
          'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 focus:ring-gray-300': variant === 'secondary',
          'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500': variant === 'danger',
          'text-gray-600 hover:bg-gray-100 focus:ring-gray-300': variant === 'ghost',
          'px-2.5 py-1.5 text-sm gap-1.5': size === 'sm',
          'px-4 py-2 text-sm gap-2': size === 'md',
          'px-5 py-2.5 text-base gap-2': size === 'lg',
        },
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
