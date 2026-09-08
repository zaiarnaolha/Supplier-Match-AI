import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Language } from '../../content';
import { Brand } from '../../components/Brand/Brand';
import { LanguageSwitcher } from '../../components/LanguageSwitcher/LanguageSwitcher';
import { Button } from '../../components/ui/button';
import styles from './Header.module.css';

export function Header({ language, onLanguageChange, nav }: { language: Language; onLanguageChange: (language: Language) => void; nav: { features: string; how: string; faq: string; login: string; signup: string } }) {
  const navigate = useNavigate();
  const [authReady, setAuthReady] = useState(Boolean(window.supplierMatchFirebase));
  const [isSigningIn, setIsSigningIn] = useState(false);

  useEffect(() => {
    if (window.supplierMatchFirebase) {
      setAuthReady(true);
      return;
    }
    const handleReady = () => setAuthReady(true);
    window.addEventListener('supplier-match-firebase-ready', handleReady, { once: true });
    return () => window.removeEventListener('supplier-match-firebase-ready', handleReady);
  }, []);

  async function signIn() {
    if (!window.supplierMatchFirebase || isSigningIn) return;
    setIsSigningIn(true);
    try {
      await window.supplierMatchFirebase.signInWithGoogle();
      navigate('/app');
    } catch (error) {
      console.error('Google sign-in failed', error);
    } finally {
      setIsSigningIn(false);
    }
  }

  return <header className={styles.header}>
    <div className={`container ${styles.inner}`}>
      <a href="#top"><Brand /></a>
      <nav aria-label="Primary"><a href="#features">{nav.features}</a><a href="#how-it-works">{nav.how}</a><a href="#faq">{nav.faq}</a></nav>
      <div className={styles.actions}>
        <LanguageSwitcher language={language} onChange={onLanguageChange} />
        <Button className={`${styles.landingButton} ${styles.ghostButton}`} variant="ghost" size="sm" type="button" disabled={!authReady || isSigningIn} onClick={() => void signIn()}>{nav.login}</Button>
        <Button className={`${styles.landingButton} ${styles.primaryButton}`} size="sm" type="button" disabled={!authReady || isSigningIn} onClick={() => void signIn()}>{nav.signup}</Button>
      </div>
    </div>
  </header>;
}
