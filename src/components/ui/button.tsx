import type { ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-small)] text-[13px] font-semibold leading-[1.2] transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  { variants: { variant: { default: 'bg-primary text-primary-foreground hover:opacity-90', outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground', secondary: 'bg-secondary text-secondary-foreground hover:opacity-80', ghost: 'hover:bg-accent hover:text-accent-foreground' }, size: { default: 'min-h-[42px] px-6 py-0', sm: 'h-8 px-3', lg: 'min-h-[46px] px-8 py-0', icon: 'size-9' } }, defaultVariants: { variant: 'default', size: 'default' } },
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
