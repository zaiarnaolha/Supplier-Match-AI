import { Link } from 'react-router-dom';
import { Button, buttonVariants } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import styles from '../Sections.module.css';
import laptop from '../../../assets/hero-laptop.png';

export function Hero({ content }: { content: { title: string; text: string; primary: string; secondary: string } }) {
  return <section id="top" className={styles.hero}>
    <div className={`container ${styles.heroInner}`}>
      <div className={styles.heroCopy}>
        <h1>{content.title}</h1>
        <p className={styles.body}>{content.text}</p>
        <div className={styles.heroActions}>
          <Link className={cn(buttonVariants({ size: 'lg' }), styles.landingButton, styles.primaryButton)} to="/app">{content.primary}</Link>
          <Button className={`${styles.landingButton} ${styles.secondaryButton}`} variant="outline" size="lg" onClick={() => document.querySelector('#how-it-works')?.scrollIntoView()}>{content.secondary}</Button>
        </div>
      </div>
      <img className={styles.heroImage} src={laptop} alt="Supplier Match AI supplier search interface displayed on a laptop" />
    </div>
  </section>;
}
