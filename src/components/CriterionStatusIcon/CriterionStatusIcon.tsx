import { Check, CircleHelp, X } from 'lucide-react';
import type { CriterionStatus } from '@/data/suppliers';
import { cn } from '@/lib/utils';
import styles from './CriterionStatusIcon.module.css';

export function CriterionStatusIcon({ status }: { status: CriterionStatus }) {
  if (status === 'Відповідає') return <span aria-label={status} className={cn(styles.statusIcon, styles.success)} data-tooltip={status} role="img" tabIndex={0}><Check aria-hidden="true" /></span>;
  if (status === 'Частково відповідає') return <span aria-label={status} className={cn(styles.statusIcon, styles.partial)} data-tooltip={status} role="img" tabIndex={0}><span aria-hidden="true">~</span></span>;
  if (status === 'Не відповідає') return <span aria-label={status} className={cn(styles.statusIcon, styles.failure)} data-tooltip={status} role="img" tabIndex={0}><X aria-hidden="true" /></span>;
  return <span aria-label={status} className={cn(styles.statusIcon, styles.unknown)} data-tooltip={status} role="img" tabIndex={0}><CircleHelp aria-hidden="true" /></span>;
}
