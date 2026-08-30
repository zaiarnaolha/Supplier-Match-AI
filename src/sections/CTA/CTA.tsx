import { Link } from 'react-router-dom';
import { buttonVariants } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import styles from '../Sections.module.css';

export function CTA({ content }: { content: { title: string; text: string; button: string } }) {
  return <section className={styles.ctaSection}>
    <div className="container">
      <div className={`content-column ${styles.cta}`}>
        <h2>{content.title}</h2>
        <p className={styles.body}>{content.text}</p>
        <Link className={cn(buttonVariants({ size: 'lg' }), styles.landingButton, styles.primaryButton)} to="/app">{content.button}</Link>
      </div>
    </div>
  </section>;
}
