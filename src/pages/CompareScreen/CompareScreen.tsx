import '../../styles/shadcn.css';
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MapPin, X } from 'lucide-react';
import { Brand } from '@/components/Brand/Brand';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { CriterionStatusIcon } from '@/components/CriterionStatusIcon/CriterionStatusIcon';
import { suppliers, type Supplier } from '@/data/suppliers';
import styles from './CompareScreen.module.css';

type CompareScreenProps = {
  selectedSupplierNames: string[];
  setSelectedSupplierNames: Dispatch<SetStateAction<string[]>>;
};

const criteriaLabels = ['Товар', 'Регіон доставки', 'MOQ', 'Ціна'];

function scoreOf(supplier: Supplier) {
  return `${supplier.match.split('%')[0]}%`;
}

function SupplierHeading({ supplier, onRemove, compact = false }: { supplier: Supplier; onRemove: () => void; compact?: boolean }) {
  return <div className={cn(styles.supplierHeading, compact && styles.compactHeading)}>
    <button className={styles.removeButton} type="button" onClick={onRemove} aria-label={`Прибрати ${supplier.name} з порівняння`} title="Прибрати з порівняння"><X aria-hidden="true" /></button>
    <h2>{supplier.name}</h2>
    <p><MapPin aria-hidden="true" />{supplier.location}</p>
    <strong><span>Match</span>{scoreOf(supplier)}</strong>
    {!compact && <small>Оновлено: {supplier.updatedAt}</small>}
  </div>;
}

export function CompareScreen({ selectedSupplierNames, setSelectedSupplierNames }: CompareScreenProps) {
  const navigate = useNavigate();
  const selectedSuppliers = selectedSupplierNames
    .map(name => suppliers.find(supplier => supplier.name === name))
    .filter((supplier): supplier is Supplier => Boolean(supplier));
  const [mobileSupplierOne, setMobileSupplierOne] = useState(selectedSuppliers[0]?.name ?? '');
  const [mobileSupplierTwo, setMobileSupplierTwo] = useState(selectedSuppliers[1]?.name ?? '');

  useEffect(() => {
    const availableNames = selectedSupplierNames.filter(name => suppliers.some(supplier => supplier.name === name));
    setMobileSupplierOne(current => availableNames.includes(current) ? current : availableNames.find(name => name !== mobileSupplierTwo) ?? '');
    setMobileSupplierTwo(current => availableNames.includes(current) && current !== mobileSupplierOne ? current : availableNames.find(name => name !== mobileSupplierOne) ?? '');
  }, [selectedSupplierNames, mobileSupplierOne, mobileSupplierTwo]);

  function removeSupplier(name: string) {
    const remaining = selectedSupplierNames.filter(supplierName => supplierName !== name);
    setSelectedSupplierNames(remaining);
    if (remaining.length < 2) navigate('/app', { replace: true });
  }

  const firstMobileSupplier = selectedSuppliers.find(supplier => supplier.name === mobileSupplierOne) ?? selectedSuppliers[0];
  const secondMobileSupplier = selectedSuppliers.find(supplier => supplier.name === mobileSupplierTwo)
    ?? selectedSuppliers.find(supplier => supplier.name !== firstMobileSupplier?.name);

  return <div className={cn('shadcn', styles.page)}>
    <header className={styles.siteHeader}><div className={styles.siteHeaderInner}>
      <Link to="/app" aria-label="Supplier Match AI"><Brand /></Link>
    </div></header>
    <main className={styles.main}>
      <Link className={styles.backLink} to="/app">← Назад до результатів</Link>
      <div className={styles.titleBlock}>
        <h1>Порівняння постачальників</h1>
        <p>Порівнюємо {selectedSuppliers.length} постачальників</p>
      </div>

      <section className={styles.desktopComparison} aria-label="Матриця порівняння постачальників">
        <div className={styles.matrix} style={{ '--supplier-count': selectedSuppliers.length } as React.CSSProperties}>
          <div className={styles.cornerCell}><span>Критерії</span></div>
          {selectedSuppliers.map(supplier => <SupplierHeading key={supplier.name} supplier={supplier} onRemove={() => removeSupplier(supplier.name)} />)}
          {criteriaLabels.map(label => <div className={styles.matrixRow} key={label}>
            <div className={styles.criterionLabel}>{label}</div>
            {selectedSuppliers.map(supplier => {
              const criterion = supplier.criteria.find(item => item.label === label)!;
              return <div className={styles.valueCell} key={supplier.name}>
                <span>{criterion.value}</span><CriterionStatusIcon status={criterion.status} />
              </div>;
            })}
          </div>)}
          <div className={styles.actionsRow}>
            <div aria-hidden="true" />
            {selectedSuppliers.map(supplier => <Button type="button" key={supplier.name} onClick={() => navigate(`/app/suppliers/${supplier.id}`)}>Переглянути</Button>)}
          </div>
        </div>
      </section>

      {firstMobileSupplier && secondMobileSupplier && <section className={styles.mobileComparison} aria-label="Мобільне порівняння постачальників">
        <div className={styles.mobileSelectors}>
          <label><span>Постачальник 1</span><Select value={firstMobileSupplier.name} onValueChange={setMobileSupplierOne}>
            <SelectTrigger className={styles.neutralSelect}><SelectValue /></SelectTrigger>
            <SelectContent>{selectedSuppliers.filter(supplier => supplier.name !== secondMobileSupplier.name).map(supplier => <SelectItem key={supplier.name} value={supplier.name}>{supplier.name}</SelectItem>)}</SelectContent>
          </Select></label>
          <label><span>Постачальник 2</span><Select value={secondMobileSupplier.name} onValueChange={setMobileSupplierTwo}>
            <SelectTrigger className={styles.neutralSelect}><SelectValue /></SelectTrigger>
            <SelectContent>{selectedSuppliers.filter(supplier => supplier.name !== firstMobileSupplier.name).map(supplier => <SelectItem key={supplier.name} value={supplier.name}>{supplier.name}</SelectItem>)}</SelectContent>
          </Select></label>
        </div>

        <div className={styles.mobileMatrix}>
          <div className={styles.mobileHeadings}>
            <SupplierHeading supplier={firstMobileSupplier} onRemove={() => removeSupplier(firstMobileSupplier.name)} compact />
            <SupplierHeading supplier={secondMobileSupplier} onRemove={() => removeSupplier(secondMobileSupplier.name)} compact />
          </div>
          {criteriaLabels.map(label => <div className={styles.mobileCriterion} key={label}>
            <h3>{label}</h3>
            <div className={styles.mobileValues}>
              {[firstMobileSupplier, secondMobileSupplier].map(supplier => {
                const criterion = supplier.criteria.find(item => item.label === label)!;
                return <div key={supplier.name}><span>{criterion.value}</span><CriterionStatusIcon status={criterion.status} /></div>;
              })}
            </div>
          </div>)}
        </div>
        <div className={styles.mobileActions}>
          <Button type="button" onClick={() => navigate(`/app/suppliers/${firstMobileSupplier.id}`)}>Переглянути</Button>
          <Button type="button" onClick={() => navigate(`/app/suppliers/${secondMobileSupplier.id}`)}>Переглянути</Button>
        </div>
      </section>}
    </main>
  </div>;
}
