import '../../styles/shadcn.css';
import { ArrowLeft, MapPin, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CriterionStatusIcon, type Supplier } from '../SupplierSearchPage/SupplierSearchPage';
import styles from './CompareScreen.module.css';

type CompareScreenProps = {
  suppliers: Supplier[];
  onBack: () => void;
  onRemove: (supplierName: string) => void;
};

const criterionLabels = ['Товар', 'Регіон доставки', 'MOQ', 'Ціна'];

export function CompareScreen({ suppliers, onBack, onRemove }: CompareScreenProps) {
  return <div className={cn('shadcn', styles.page)}>
    <header className={styles.siteHeader}><div className={styles.headerInner}>
      <Link className={styles.brand} to="/app"><span>SM</span>Supplier Match <b>AI</b></Link>
    </div></header>
    <main className={styles.main}>
      <button className={styles.back} type="button" onClick={onBack}><ArrowLeft aria-hidden="true" size={16} />Назад до результатів</button>
      <div className={styles.titleBlock}>
        <h1>Порівняння постачальників</h1>
        <p>Порівнюємо {suppliers.length} постачальників</p>
      </div>

      <section className={styles.comparisonCard} aria-label="Порівняння вибраних постачальників">
        <div className={styles.desktopMatrix} style={{ '--supplier-count': suppliers.length } as React.CSSProperties}>
          <div className={styles.emptyCell} aria-hidden="true" />
          {suppliers.map(supplier => <SupplierSummary key={supplier.name} supplier={supplier} onRemove={onRemove} />)}
          {criterionLabels.map(label => <div className={styles.matrixRow} key={label}>
            <h2>{label}</h2>
            {suppliers.map(supplier => {
              const criterion = supplier.criteria.find(item => item.label === label)!;
              return <div className={styles.valueCell} key={supplier.name}>
                <span>{criterion.value}</span><CriterionStatusIcon status={criterion.status} />
              </div>;
            })}
          </div>)}
          <div className={styles.matrixRow}>
            <h2>Оновлено</h2>
            {suppliers.map(supplier => <div className={styles.updatedCell} key={supplier.name}>{supplier.updatedAt}</div>)}
          </div>
          <div className={styles.matrixRow}>
            <span aria-hidden="true" />
            {suppliers.map(supplier => <div className={styles.actionCell} key={supplier.name}><Button type="button">Переглянути постачальника</Button></div>)}
          </div>
        </div>

        <div className={styles.mobileComparison}>
          <div className={styles.mobileSummaries}>{suppliers.map(supplier => <SupplierSummary key={supplier.name} supplier={supplier} onRemove={onRemove} />)}</div>
          <div className={styles.mobileCriteria}>{criterionLabels.map(label => <section key={label}>
            <h2>{label}</h2>
            {suppliers.map(supplier => {
              const criterion = supplier.criteria.find(item => item.label === label)!;
              return <div className={styles.mobileValue} key={supplier.name}>
                <div><strong>{supplier.name}</strong><span>{criterion.value}</span></div>
                <CriterionStatusIcon status={criterion.status} />
              </div>;
            })}
          </section>)}</div>
          <section className={styles.mobileActions} aria-label="Дії з постачальниками">
            <h2>Постачальники</h2>
            {suppliers.map(supplier => <div key={supplier.name}><div><strong>{supplier.name}</strong><span>Оновлено: {supplier.updatedAt}</span></div><Button type="button">Переглянути постачальника</Button></div>)}
          </section>
        </div>
      </section>
    </main>
  </div>;
}

function SupplierSummary({ supplier, onRemove }: { supplier: Supplier; onRemove: (name: string) => void }) {
  const score = supplier.match.split('%')[0];
  return <article className={styles.summary}>
    <button className={styles.remove} type="button" onClick={() => onRemove(supplier.name)} aria-label={`Прибрати ${supplier.name} з порівняння`}><X aria-hidden="true" size={16} /></button>
    <h2>{supplier.name}</h2>
    <p><MapPin aria-hidden="true" size={14} />{supplier.location}</p>
    <div className={styles.match}><span>Match</span><strong>{score}%</strong></div>
    <small>Оновлено: {supplier.updatedAt}</small>
  </article>;
}
