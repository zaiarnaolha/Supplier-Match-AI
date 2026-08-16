import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.css';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode; variant?: 'primary'|'secondary'|'ghost'; size?: 'small'|'medium'|'large' };
export function Button({children,variant='primary',size='medium',className='',...props}:Props){
  return <button className={`${styles.button} ${styles[variant]} ${styles[size]} ${className}`} {...props}>{children}</button>;
}
