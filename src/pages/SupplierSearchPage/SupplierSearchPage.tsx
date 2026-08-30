import '../../styles/shadcn.css';
import { useEffect, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Brand } from '@/components/Brand/Brand';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { suppliers, type Supplier } from '@/data/suppliers';
import { CriterionStatusIcon } from '@/components/CriterionStatusIcon/CriterionStatusIcon';
import { ArrowRight, Box, ChevronDown, MapPin, RotateCcw, Search, SlidersHorizontal, Sparkles } from 'lucide-react';
import styles from './SupplierSearchPage.module.css';

export type SearchStage = 'idle' | 'loading' | 'clarification' | 'search-ready';
function Filters() {
  const [category, setCategory] = useState('coffee');
  const [region, setRegion] = useState('ukraine');
  const [price, setPrice] = useState('any');
  const [moq, setMoq] = useState('any');
  function clearFilters() {
    setCategory('coffee');
    setRegion('ukraine');
    setPrice('any');
    setMoq('any');
  }

  return <div className={styles.filterFields}>
    <label><span>Категорія</span><Select value={category} onValueChange={setCategory}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="coffee">Кава</SelectItem><SelectItem value="grocery">Бакалія</SelectItem></SelectContent></Select></label>
    <label><span>Країна / регіон</span><Select value={region} onValueChange={setRegion}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ukraine">Україна</SelectItem><SelectItem value="europe">Європа</SelectItem></SelectContent></Select></label>
    <label><span>Ціна</span><Select value={price} onValueChange={setPrice}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="any">Будь-яка</SelectItem><SelectItem value="300">До 300 грн/кг</SelectItem><SelectItem value="500">До 500 грн/кг</SelectItem></SelectContent></Select></label>
    <label><span>MOQ</span><Select value={moq} onValueChange={setMoq}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="any">Будь-яке</SelectItem><SelectItem value="10">До 10 кг</SelectItem><SelectItem value="50">До 50 кг</SelectItem></SelectContent></Select></label>
    <Button className={styles.clearFilters} variant="outline" type="button" onClick={clearFilters}><RotateCcw size={15} />Очистити фільтри</Button>
  </div>;
}

type SupplierCardProps = {
  supplier: Supplier;
  isSelected: boolean;
  onCompareChange: (supplierName: string, shouldSelect: boolean) => void;
};

function SupplierCard({ supplier, isSelected, onCompareChange }: SupplierCardProps) {
  const navigate = useNavigate();
  const checkboxId = `compare-${supplier.name.toLowerCase().replace(/\s+/g, '-')}`;
  const score = supplier.match.split('%')[0];
  return <article className={cn(styles.supplierCard, isSelected && styles.supplierCardSelected)}>
    <div className={styles.supplierSummary}>
      <div className={styles.supplierIdentity}>
        <div className={styles.supplierIcon}><Box size={21} /></div>
        <div className={styles.supplierInfo}><h3>{supplier.name}</h3><p><MapPin size={13} />{supplier.location}</p></div>
      </div>
      <div className={styles.matchBlock}>
        <div className={styles.matchScore}><strong>{score}%</strong><span>Match</span></div>
        <p className={styles.breakdown}>{supplier.breakdown}</p>
      </div>
      <small className={styles.updatedAt}>Оновлено: {supplier.updatedAt}</small>
    </div>
    <div className={styles.criteriaArea}>
      <dl className={styles.criteria}>
        {supplier.criteria.map((criterion) => <div key={criterion.label}>
          <dt>{criterion.label}</dt><dd>{criterion.value}</dd>
          <CriterionStatusIcon status={criterion.status} />
        </div>)}
      </dl>
    </div>
    <div className={styles.supplierActions}>
      <label htmlFor={checkboxId}><Checkbox id={checkboxId} checked={isSelected} onCheckedChange={(checked: boolean | 'indeterminate') => onCompareChange(supplier.name, checked === true)} /><span>Додати до порівняння</span></label>
      <Button type="button" onClick={() => navigate(`/app/suppliers/${supplier.id}`)}>Переглянути постачальника<ArrowRight size={16} /></Button>
    </div>
  </article>;
}

function isSpecificRequest(query: string) { return query.trim().length >= 25 && query.trim().split(/\s+/).length >= 5; }

type SupplierSearchPageProps = {
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  stage: SearchStage;
  setStage: Dispatch<SetStateAction<SearchStage>>;
  deliveryRegion: string;
  setDeliveryRegion: Dispatch<SetStateAction<string>>;
  selectedSuppliers: string[];
  setSelectedSuppliers: Dispatch<SetStateAction<string[]>>;
  showCompareLimit: boolean;
  setShowCompareLimit: Dispatch<SetStateAction<boolean>>;
};

export function SupplierSearchPage({ query, setQuery, stage, setStage, deliveryRegion, setDeliveryRegion, selectedSuppliers, setSelectedSuppliers, showCompareLimit, setShowCompareLimit }: SupplierSearchPageProps) {
  const navigate = useNavigate();
  const loadingTimer = useRef<number | null>(null);
  useEffect(() => () => { if (loadingTimer.current !== null) window.clearTimeout(loadingTimer.current); }, []);
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!query.trim() || stage === 'loading') return;
    setStage('loading'); loadingTimer.current = window.setTimeout(() => { setStage(isSpecificRequest(query) ? 'search-ready' : 'clarification'); loadingTimer.current = null; }, 700);
  }
  function handleCompareChange(supplierName: string, shouldSelect: boolean) {
    if (!shouldSelect) {
      setSelectedSuppliers(current => current.filter(name => name !== supplierName));
      setShowCompareLimit(false);
      return;
    }

    if (selectedSuppliers.includes(supplierName)) return;
    if (selectedSuppliers.length >= 3) {
      setShowCompareLimit(true);
      return;
    }
    setSelectedSuppliers(current => [...current, supplierName]);
    setShowCompareLimit(false);
  }

  return <div className={cn('shadcn', styles.page)}>
    <header className={styles.header}><div className={styles.headerInner}>
      <Link to="/app" aria-label="Supplier Match AI"><Brand /></Link>
    </div></header>
    <main className={styles.main}>
      <section className={styles.searchCard} id="search">
        <h1>Опишіть, що вам потрібно знайти</h1>
        <form onSubmit={handleSubmit}>
          <div className={styles.searchInput}><Search size={20} /><Input size="sm" className="pl-10" aria-label="Опишіть потребу в постачальнику" placeholder="Наприклад: шукаю постачальника бакалії з доставкою до Коломиї" value={query} onChange={e => setQuery(e.target.value)} disabled={stage === 'loading' || stage === 'search-ready'} /></div>
          {(stage === 'idle' || stage === 'loading') && <Button size="sm" type="submit" disabled={!query.trim() || stage === 'loading'}><Sparkles size={16} />{stage === 'loading' ? 'Аналізуємо запит…' : 'Знайти постачальників'}</Button>}
        </form>
        {stage === 'clarification' && <div className={styles.clarification}>
          <div><strong>Уточніть регіон доставки</strong><p>Це допоможе знайти релевантніші варіанти.</p></div>
          <Select value={deliveryRegion} onValueChange={setDeliveryRegion}><SelectTrigger size="sm" className={styles.neutralSelect} aria-label="Регіон отримання товару"><SelectValue placeholder="Оберіть регіон" /></SelectTrigger><SelectContent><SelectItem value="ukraine">Україна</SelectItem><SelectItem value="europe">Європа</SelectItem><SelectItem value="asia">Азія</SelectItem><SelectItem value="anywhere">Будь-яка країна</SelectItem></SelectContent></Select>
          <Button size="sm" type="button" disabled={!deliveryRegion} onClick={() => setStage('search-ready')}>Продовжити пошук</Button>
        </div>}
      </section>

      {stage === 'search-ready' && <section className={styles.resultsLayout} aria-labelledby="search-results-title" aria-live="polite">
        <aside className={styles.filters}><div className={styles.filterTitle}><SlidersHorizontal size={17}/><h2>Фільтри</h2></div><Filters /></aside>
        <details className={styles.mobileFilters}><summary><span><SlidersHorizontal size={17}/>Фільтри</span><ChevronDown size={18}/></summary><Filters /></details>
        <div className={styles.resultsCard}>
          <div className={styles.resultsHeader}><h2 id="search-results-title">Результати пошуку</h2><p>Кава · Україна <span>· Знайдено постачальників: {suppliers.length}</span></p></div>
          <div className={styles.supplierList}>{suppliers.map(supplier => <SupplierCard key={supplier.name} supplier={supplier} isSelected={selectedSuppliers.includes(supplier.name)} onCompareChange={handleCompareChange} />)}</div>
          {showCompareLimit && <p className={styles.compareLimit} role="status">Для порівняння можна обрати до 3 постачальників</p>}
          {selectedSuppliers.length >= 2 && <div className={styles.compareBar} aria-label={`Обрано постачальників: ${selectedSuppliers.length}`}>
            <div><strong>Обрано для порівняння</strong><span>{selectedSuppliers.length} з 3 постачальників</span></div>
            <Button type="button" aria-label={`Порівняти ${selectedSuppliers.length} постачальників`} onClick={() => navigate('/app/compare')}>Порівняти ({selectedSuppliers.length})</Button>
          </div>}
        </div>
      </section>}
    </main>
  </div>;
}
