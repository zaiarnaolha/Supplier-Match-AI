import type { Language } from '../../content';
import styles from './LanguageSwitcher.module.css';
export function LanguageSwitcher({language,onChange}:{language:Language;onChange:(language:Language)=>void}){
  return <div className={styles.switcher} aria-label="Language"><button className={language==='en'?styles.active:''} onClick={()=>onChange('en')} aria-pressed={language==='en'}>EN</button><button className={language==='ua'?styles.active:''} onClick={()=>onChange('ua')} aria-pressed={language==='ua'}>UA</button></div>
}
