import type { Language } from '../../content';
import { Brand } from '../../components/Brand/Brand';
import { LanguageSwitcher } from '../../components/LanguageSwitcher/LanguageSwitcher';
import { Button } from '../../components/ui/button';
import styles from './Header.module.css';

export function Header({ language, onLanguageChange, nav }: { language: Language; onLanguageChange: (language: Language) => void; nav: { features: string; how: string; faq: string; login: string; signup: string } }) {
  return <header className={styles.header}>
    <div className={`container ${styles.inner}`}>
      <a href="#top"><Brand /></a>
      <nav aria-label="Primary"><a href="#features">{nav.features}</a><a href="#how-it-works">{nav.how}</a><a href="#faq">{nav.faq}</a></nav>
      <div className={styles.actions}>
        <LanguageSwitcher language={language} onChange={onLanguageChange} />
        <Button className={`${styles.landingButton} ${styles.ghostButton}`} variant="ghost" size="sm">{nav.login}</Button>
        <Button className={`${styles.landingButton} ${styles.primaryButton}`} size="sm">{nav.signup}</Button>
      </div>
    </div>
  </header>;
}
