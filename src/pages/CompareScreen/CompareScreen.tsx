import '../../styles/shadcn.css';
import { useEffect, useState, type CSSProperties } from 'react';
import { ArrowLeft, MapPin, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
  const [firstSupplierName, setFirstSupplierName] = useState(suppliers[0].name);
  const [secondSupplierName, setSecondSupplierName] = useState(suppliers[1].name);
  const firstSupplier = suppliers.find(supplier => supplier.name === firstSupplierName)
    ?? suppliers.find(supplier => supplier.name !== secondSupplierName)
    ?? suppliers[0];
  const secondSupplier = suppliers.find(supplier => supplier.name === secondSupplierName && supplier.name !== firstSupplier.name)
    ?? suppliers.find(supplier => supplier.name !== firstSupplier.name)
    ?? suppliers[1];
  const mobileSuppliers = [firstSupplier, secondSupplier];

  useEffect(() => {
    if (firstSupplierName !== firstSupplier.name) setFirstSupplierName(firstSupplier.name);
    if (secondSupplierName !== secondSupplier.name) setSecondSupplierName(secondSupplier.name);
  }, [firstSupplier.name, firstSupplierName, secondSupplier.name, secondSupplierName]);

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
        <div className={styles.desktopMatrix} style={{ '--supplier-count': suppliers.length } as CSSProperties}>
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
          <div className={styles.mobilePicker}>
            <div><span>Постачальник 1</span><Select value={firstSupplier.name} onValueChange={setFirstSupplierName}>
              <SelectTrigger aria-label="Постачальник 1"><SelectValue /></SelectTrigger>
              <SelectContent>{suppliers.filter(supplier => supplier.name !== secondSupplier.name).map(supplier => <SelectItem key={supplier.name} value={supplier.name}>{supplier.name}</SelectItem>)}</SelectContent>
            </Select></div>
            <div><span>Постачальник 2</span><Select value={secondSupplier.name} onValueChange={setSecondSupplierName}>
              <SelectTrigger aria-label="Постачальник 2"><SelectValue /></SelectTrigger>
              <SelectContent>{suppliers.filter(supplier => supplier.name !== firstSupplier.name).map(supplier => <SelectItem key={supplier.name} value={supplier.name}>{supplier.name}</SelectItem>)}</SelectContent>
            </Select></div>
          </div>
          <div className={styles.mobileSupplierHeaders}>{mobileSuppliers.map(supplier => <MobileSupplierHeader key={supplier.name} supplier={supplier} onRemove={onRemove} />)}</div>
          <div className={styles.mobileMatrix}>
            <section><h2>Match</h2><div className={styles.mobileColumns}>{mobileSuppliers.map(supplier => <strong className={styles.mobileMatch} key={supplier.name}>{supplier.match.split('%')[0]}%</strong>)}</div></section>
            {criterionLabels.map(label => <section key={label}>
              <h2>{label}</h2>
              <div className={styles.mobileColumns}>{mobileSuppliers.map(supplier => {
              const criterion = supplier.criteria.find(item => item.label === label)!;
              return <div className={styles.mobileValue} key={supplier.name}>
                <span>{criterion.value}</span>
                <CriterionStatusIcon status={criterion.status} />
              </div>;
              })}</div>
            </section>)}
          </div>
          <section className={styles.mobileActions} aria-label="Дії з постачальниками">
            {mobileSuppliers.map(supplier => <Button type="button" key={supplier.name}>Переглянути {supplier.name.split(' ').slice(0, 2).join(' ')}</Button>)}
          </section>
        </div>
      </section>
    </main>
  </div>;
}

function MobileSupplierHeader({ supplier, onRemove }: { supplier: Supplier; onRemove: (name: string) => void }) {
  return <article>
    <button type="button" onClick={() => onRemove(supplier.name)} aria-label={`Прибрати ${supplier.name} з порівняння`}><X aria-hidden="true" size={14} /></button>
    <h2>{supplier.name}</h2>
    <p><MapPin aria-hidden="true" size={12} />{supplier.location}</p>
    <strong>Match {supplier.match.split('%')[0]}%</strong>
  </article>;
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
