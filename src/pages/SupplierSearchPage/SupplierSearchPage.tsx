import '../../styles/shadcn.css';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Box, Check, ChevronDown, CircleHelp, MapPin, Search, SlidersHorizontal, Sparkles } from 'lucide-react';
import styles from './SupplierSearchPage.module.css';

type SearchStage = 'idle' | 'loading' | 'clarification' | 'search-ready';
type CriterionStatus = 'Відповідає' | 'Частково відповідає' | 'Немає даних';

type Supplier = {
  name: string;
  location: string;
  match: string;
  breakdown: string;
  updatedAt: string;
  criteria: { label: string; value: string; status: CriterionStatus }[];
};

const suppliers: Supplier[] = [
  { name: 'Coffee Trade Ukraine', location: 'Київ, Україна', match: '92% Match', breakdown: '3 критерії відповідають · 1 частково', updatedAt: '12 серпня 2026', criteria: [
    { label: 'Товар', value: 'кава та кавова продукція', status: 'Відповідає' }, { label: 'Регіон доставки', value: 'Україна', status: 'Відповідає' }, { label: 'MOQ', value: 'від 10 кг', status: 'Відповідає' }, { label: 'Ціна', value: 'від 320 грн/кг', status: 'Частково відповідає' },
  ] },
  { name: 'Bean Supply Europe', location: 'Львів, Україна', match: '78% Match', breakdown: '2 критерії відповідають · 2 частково', updatedAt: '8 серпня 2026', criteria: [
    { label: 'Товар', value: 'кава в зернах', status: 'Відповідає' }, { label: 'Регіон доставки', value: 'Україна', status: 'Відповідає' }, { label: 'MOQ', value: 'від 50 кг', status: 'Частково відповідає' }, { label: 'Ціна', value: 'від 290 грн/кг', status: 'Частково відповідає' },
  ] },
  { name: 'Roast Partners', location: 'Краків, Польща', match: '64% Match', breakdown: '2 критерії відповідають · 2 без даних', updatedAt: '28 липня 2026', criteria: [
    { label: 'Товар', value: 'кава та обсмажене зерно', status: 'Відповідає' }, { label: 'Регіон доставки', value: 'Україна', status: 'Відповідає' }, { label: 'MOQ', value: 'Не вказано', status: 'Немає даних' }, { label: 'Ціна', value: 'Не вказано', status: 'Немає даних' },
  ] },
];

function CriterionStatusIcon({ status }: { status: CriterionStatus }) {
  if (status === 'Відповідає') {
    return <span aria-label={status} className={cn(styles.statusIcon, styles.success)} role="img" tabIndex={0} title={status}><Check aria-hidden="true" /></span>;
  }
  if (status === 'Частково відповідає') {
    return <span aria-label={status} className={cn(styles.statusIcon, styles.partial)} role="img" tabIndex={0} title={status}><span aria-hidden="true" /></span>;
  }
  return <span aria-label={status} className={cn(styles.statusIcon, styles.unknown)} role="img" tabIndex={0} title={status}><CircleHelp aria-hidden="true" /></span>;
}

function Filters() {
  return <div className={styles.filterFields}>
    <label><span>Категорія</span><Select defaultValue="coffee"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="coffee">Кава</SelectItem><SelectItem value="grocery">Бакалія</SelectItem></SelectContent></Select></label>
    <label><span>Країна / регіон</span><Select defaultValue="ukraine"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ukraine">Україна</SelectItem><SelectItem value="europe">Європа</SelectItem></SelectContent></Select></label>
    <label><span>Ціна</span><Select defaultValue="any"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="any">Будь-яка</SelectItem><SelectItem value="300">До 300 грн/кг</SelectItem><SelectItem value="500">До 500 грн/кг</SelectItem></SelectContent></Select></label>
    <label><span>MOQ</span><Select defaultValue="any"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="any">Будь-яке</SelectItem><SelectItem value="10">До 10 кг</SelectItem><SelectItem value="50">До 50 кг</SelectItem></SelectContent></Select></label>
  </div>;
}

function SupplierCard({ supplier }: { supplier: Supplier }) {
  const checkboxId = `compare-${supplier.name.toLowerCase().replace(/\s+/g, '-')}`;
  const score = supplier.match.split('%')[0];
  return <article className={styles.supplierCard}>
    <div className={styles.supplierIdentity}>
      <div className={styles.supplierIcon}><Box size={21} /></div>
      <div><h3>{supplier.name}</h3><p><MapPin size={13} />{supplier.location}</p></div>
    </div>
    <div className={styles.matchBlock}><span>Match</span><strong>{score}%</strong><small>{supplier.breakdown}</small></div>
    <dl className={styles.criteria}>
      {supplier.criteria.map((criterion) => <div key={criterion.label}>
        <dt>{criterion.label}</dt><dd>{criterion.value}</dd>
        <CriterionStatusIcon status={criterion.status} />
      </div>)}
    </dl>
    <div className={styles.supplierActions}>
      <p>Оновлено: {supplier.updatedAt}</p>
      <label htmlFor={checkboxId}><Checkbox id={checkboxId} /><span>Додати до порівняння</span></label>
      <Button type="button">Переглянути постачальника</Button>
    </div>
  </article>;
}

function isSpecificRequest(query: string) { return query.trim().length >= 25 && query.trim().split(/\s+/).length >= 5; }

export function SupplierSearchPage() {
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState<SearchStage>('idle');
  const [deliveryRegion, setDeliveryRegion] = useState('');
  const loadingTimer = useRef<number | null>(null);
  useEffect(() => () => { if (loadingTimer.current !== null) window.clearTimeout(loadingTimer.current); }, []);
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!query.trim() || stage === 'loading') return;
    setStage('loading'); loadingTimer.current = window.setTimeout(() => { setStage(isSpecificRequest(query) ? 'search-ready' : 'clarification'); loadingTimer.current = null; }, 700);
  }

  return <div className={cn('shadcn', styles.page)}>
    <header className={styles.header}><div className={styles.headerInner}>
      <Link className={styles.brand} to="/app"><span>SM</span>Supplier Match <b>AI</b></Link>
    </div></header>
    <main className={styles.main}>
      <section className={styles.searchCard} id="search">
        <h1>Опишіть, що вам потрібно знайти</h1>
        <form onSubmit={handleSubmit}>
          <div className={styles.searchInput}><Search size={20} /><input aria-label="Опишіть потребу в постачальнику" placeholder="Наприклад: шукаю постачальника бакалії з доставкою до Коломиї" value={query} onChange={e => setQuery(e.target.value)} disabled={stage === 'loading' || stage === 'search-ready'} /></div>
          {(stage === 'idle' || stage === 'loading') && <Button type="submit" disabled={!query.trim() || stage === 'loading'}><Sparkles size={16} />{stage === 'loading' ? 'Аналізуємо запит…' : 'Знайти постачальників'}</Button>}
        </form>
        {stage === 'clarification' && <div className={styles.clarification}>
          <div><strong>Уточніть регіон доставки</strong><p>Це допоможе знайти релевантніші варіанти.</p></div>
          <Select value={deliveryRegion} onValueChange={setDeliveryRegion}><SelectTrigger className={styles.neutralSelect} aria-label="Регіон отримання товару"><SelectValue placeholder="Оберіть регіон" /></SelectTrigger><SelectContent><SelectItem value="ukraine">Україна</SelectItem><SelectItem value="europe">Європа</SelectItem><SelectItem value="asia">Азія</SelectItem><SelectItem value="anywhere">Будь-яка країна</SelectItem></SelectContent></Select>
          <Button type="button" disabled={!deliveryRegion} onClick={() => setStage('search-ready')}>Продовжити пошук</Button>
        </div>}
      </section>

      {stage === 'search-ready' && <section className={styles.resultsLayout} aria-labelledby="search-results-title" aria-live="polite">
        <aside className={styles.filters}><div className={styles.filterTitle}><SlidersHorizontal size={17}/><h2>Фільтри</h2></div><Filters /></aside>
        <details className={styles.mobileFilters}><summary><span><SlidersHorizontal size={17}/>Фільтри</span><ChevronDown size={18}/></summary><Filters /></details>
        <div className={styles.resultsCard}>
          <div className={styles.resultsHeader}><div><h2 id="search-results-title">Результати пошуку</h2><p>Кава · Україна <span>· Знайдено 3 постачальники</span></p></div><Select defaultValue="best"><SelectTrigger className={styles.sortSelect} aria-label="Сортування"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="best">Найкраще співпадіння</SelectItem><SelectItem value="new">Нещодавно оновлені</SelectItem></SelectContent></Select></div>
          <div className={styles.supplierList}>{suppliers.map(supplier => <SupplierCard key={supplier.name} supplier={supplier} />)}</div>
        </div>
      </section>}
    </main>
  </div>;
}
