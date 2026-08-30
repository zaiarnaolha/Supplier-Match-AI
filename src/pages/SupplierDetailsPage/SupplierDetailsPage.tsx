import '../../styles/shadcn.css';
import { ArrowLeft, ExternalLink, Globe, Mail, MapPin, Phone } from 'lucide-react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { CriterionStatusIcon } from '@/components/CriterionStatusIcon/CriterionStatusIcon';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { suppliers } from '@/data/suppliers';
import { cn } from '@/lib/utils';
import styles from './SupplierDetailsPage.module.css';

export function SupplierDetailsPage() {
  const { id } = useParams();
  const supplier = suppliers.find(item => item.id === id);
  if (!supplier) return <Navigate to="/app" replace />;

  const missingCriteria = supplier.criteria.filter(item => item.status === 'Немає даних');
  const score = supplier.match.split('%')[0];

  return <div className={cn('shadcn', styles.page)}>
    <header className={styles.siteHeader}><div className={styles.siteHeaderInner}>
      <Link className={styles.brand} to="/app"><span>SM</span>Supplier Match <b>AI</b></Link>
    </div></header>
    <main className={styles.main}>
      <Link className={styles.backLink} to="/app"><ArrowLeft aria-hidden="true" />Назад до результатів</Link>

      <Card className={styles.hero}>
        <CardContent className={styles.heroContent}>
          <div className={styles.identity}>
            <div><h1>{supplier.name}</h1><p className={styles.location}><MapPin aria-hidden="true" />{supplier.location}</p></div>
            <div className={styles.match}><span>Match</span><strong>{score}%</strong></div>
          </div>
          <p className={styles.summary}>{supplier.description}</p>
          <a className={buttonVariants()} href={supplier.website} target="_blank" rel="noreferrer">Перейти на сайт<ExternalLink aria-hidden="true" /></a>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Чому підходить під ваш запит</CardTitle></CardHeader>
        <CardContent><dl className={styles.criteria}>{supplier.criteria.map(criterion => <div key={criterion.label}>
          <dt>{criterion.label}</dt><dd>{criterion.value}</dd><CriterionStatusIcon status={criterion.status} />
        </div>)}</dl></CardContent>
      </Card>

      <div className={styles.columns}>
        <Card><CardHeader><CardTitle>Про постачальника</CardTitle></CardHeader><CardContent><p className={styles.bodyText}>{supplier.description}</p></CardContent></Card>
        <Card><CardHeader><CardTitle>Контактна інформація</CardTitle></CardHeader><CardContent><address className={styles.contacts}>
          <a href={supplier.website} target="_blank" rel="noreferrer"><Globe aria-hidden="true" /><span><small>Website</small>{supplier.website}</span></a>
          <a href={`mailto:${supplier.email}`}><Mail aria-hidden="true" /><span><small>Email</small>{supplier.email}</span></a>
          <a href={`tel:${supplier.phone.replace(/\s/g, '')}`}><Phone aria-hidden="true" /><span><small>Phone</small>{supplier.phone}</span></a>
        </address></CardContent></Card>
      </div>

      {missingCriteria.length > 0 && <Card className={styles.missing}><CardHeader><CardTitle>Дані, які варто уточнити</CardTitle></CardHeader><CardContent><ul>{missingCriteria.map(item => <li key={item.label}>{item.label}</li>)}</ul></CardContent></Card>}
    </main>
  </div>;
}
