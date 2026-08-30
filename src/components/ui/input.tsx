import type { ComponentProps } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const inputVariants = cva(
  'w-full rounded-md border border-input bg-transparent py-1 text-sm shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
  { variants: { size: { default: 'h-9 px-3', sm: 'h-8 px-3' } }, defaultVariants: { size: 'default' } },
);

type InputProps = Omit<ComponentProps<'input'>, 'size'> & VariantProps<typeof inputVariants>;

export function Input({ className, type, size, ...props }: InputProps) {
  return <input data-slot="input" type={type} className={cn(inputVariants({ size }), className)} {...props} />;
}
