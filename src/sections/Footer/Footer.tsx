import { Brand } from '../../components/Brand/Brand';
import styles from '../Sections.module.css';

export function Footer({ content }: { content: { tagline: string; copyright: string } }) {
  return <footer className={styles.footer}>
    <div className={`container ${styles.footerInner}`}><Brand /><p>{content.tagline}</p><p>{content.copyright}</p></div>
  </footer>;
}
