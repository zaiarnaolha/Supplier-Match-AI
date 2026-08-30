import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import styles from './Brand.module.css';

type BrandProps = HTMLAttributes<HTMLSpanElement>;

export function Brand({ className, ...props }: BrandProps) {
  return <span className={cn(styles.brand, className)} {...props}>
    <span className={styles.mark} aria-hidden="true">SM</span>
    <span>Supplier Match <b>AI</b></span>
  </span>;
}
