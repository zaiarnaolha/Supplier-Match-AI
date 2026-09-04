import '../../styles/shadcn.css';
import { useEffect, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Brand } from '@/components/Brand/Brand';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { Supplier } from '@/data/suppliers';
import { CriterionStatusIcon } from '@/components/CriterionStatusIcon/CriterionStatusIcon';
import { Box, ChevronDown, MapPin, RotateCcw, Search, SlidersHorizontal, Sparkles } from 'lucide-react';
import styles from './SupplierSearchPage.module.css';
import { buildSupplierSearchRequest } from '../../../shared/supplier-search-criteria';

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
    <Button className={styles.clearFilters} variant="outline" size="sm" type="button" onClick={clearFilters}><RotateCcw size={14} />Очистити фільтри</Button>
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
      <div className={styles.matchSummary}>
        <div className={styles.matchBlock}><strong>{score}%</strong><span>Match</span></div>
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
      <Button type="button" onClick={() => navigate(`/app/suppliers/${supplier.id}`)}>Переглянути постачальника</Button>
    </div>
  </article>;
}

function isSpecificRequest(query: string) { return query.trim().length >= 25 && query.trim().split(/\s+/).length >= 5; }

type SearchResult = {
  title: string;
  url: string;
  content: string;
  score: number;
  product: string | null;
  country: string | null;
  supplierLocation: string | null;
  moq: string | null;
  price: string | null;
  delivery: {
    region: string;
    status: 'confirmed' | 'not_confirmed' | 'not_available';
    evidence: string | null;
    sourceUrl: string | null;
    sourceType: 'official' | 'external' | null;
  };
};

function isSearchResult(value: unknown): value is SearchResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return typeof result.title === 'string'
    && typeof result.url === 'string'
    && typeof result.content === 'string'
    && typeof result.score === 'number'
    && Number.isFinite(result.score)
    && (typeof result.product === 'string' || result.product === null)
    && (typeof result.country === 'string' || result.country === null)
    && (typeof result.supplierLocation === 'string' || result.supplierLocation === null)
    && (typeof result.moq === 'string' || result.moq === null)
    && (typeof result.price === 'string' || result.price === null)
    && result.delivery !== null
    && typeof result.delivery === 'object'
    && !Array.isArray(result.delivery)
    && typeof (result.delivery as Record<string, unknown>).region === 'string'
    && ['confirmed', 'not_confirmed', 'not_available'].includes(String((result.delivery as Record<string, unknown>).status));
}

function mapSearchResult(result: SearchResult, index: number): Supplier {
  let hostname = 'supplier';
  try {
    hostname = new URL(result.url).hostname.replace(/^www\./, '') || hostname;
  } catch {
    // The API validates the field type, while the original URL remains available below.
  }

  const relevance = Math.round(Math.max(0, Math.min(1, result.score)) * 100);
  return {
    id: `${index}-${hostname.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}`,
    name: result.title,
    location: result.supplierLocation ?? 'Не вказано',
    match: `${relevance}% Match`,
    breakdown: 'Структуровані критерії недоступні',
    updatedAt: 'Не вказано',
    description: result.content,
    website: result.url,
    email: '',
    phone: '',
    criteria: [
      {
        label: 'Товар',
        value: result.product ?? 'Не вказано',
        status: result.product ? 'Відповідає' as const : 'Немає даних' as const,
      },
      {
        label: 'Регіон доставки',
        value: result.delivery.status === 'confirmed' ? result.delivery.region : `Не підтверджено для ${result.delivery.region}`,
        status: result.delivery.status === 'confirmed' ? 'Відповідає' as const : 'Немає даних' as const,
      },
      { label: 'MOQ', value: result.moq ?? 'Не вказано', status: result.moq ? 'Відповідає' as const : 'Немає даних' as const },
      { label: 'Ціна', value: result.price ?? 'Не вказано', status: result.price ? 'Відповідає' as const : 'Немає даних' as const },
    ],
  };
}

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
  searchResults: Supplier[];
  setSearchResults: Dispatch<SetStateAction<Supplier[]>>;
};

export function SupplierSearchPage({ query, setQuery, stage, setStage, deliveryRegion, setDeliveryRegion, selectedSuppliers, setSelectedSuppliers, showCompareLimit, setShowCompareLimit, searchResults, setSearchResults }: SupplierSearchPageProps) {
  const navigate = useNavigate();
  const requestController = useRef<AbortController | null>(null);
  const [searchError, setSearchError] = useState('');
  useEffect(() => () => requestController.current?.abort(), []);

  async function searchSuppliers(region: string, errorStage: SearchStage) {
    const controller = new AbortController();
    requestController.current?.abort();
    requestController.current = controller;
    setSearchError('');
    setStage('loading');
    const requestBody = buildSupplierSearchRequest(query, region);

    try {
      const response = await fetch('/api/search-suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      let data: unknown;
      try {
        data = await response.json();
      } catch {
        throw new Error('Сервіс пошуку повернув некоректну відповідь.');
      }
      if (!response.ok) {
        throw new Error('Не вдалося виконати пошук постачальників. Спробуйте ще раз.');
      }
      if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error('Сервіс пошуку повернув некоректну відповідь.');
      const results = (data as Record<string, unknown>).results;
      if (!Array.isArray(results) || !results.every(isSearchResult)) throw new Error('Сервіс пошуку повернув некоректну відповідь.');

      setSearchResults(results.map(mapSearchResult));
      setSelectedSuppliers([]);
      setShowCompareLimit(false);
      setStage('search-ready');
    } catch (error) {
      if (controller.signal.aborted) return;
      setSearchResults([]);
      setSelectedSuppliers([]);
      setShowCompareLimit(false);
      setSearchError(error instanceof Error ? error.message : 'Не вдалося виконати пошук постачальників. Спробуйте ще раз.');
      setStage(errorStage);
    } finally {
      if (requestController.current === controller) requestController.current = null;
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!query.trim() || stage === 'loading') return;
    setSearchError('');
    if (!isSpecificRequest(query)) {
      setStage('clarification');
      return;
    }
    void searchSuppliers(deliveryRegion, 'idle');
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
          <Button size="sm" type="button" disabled={!deliveryRegion} onClick={() => void searchSuppliers(deliveryRegion, 'clarification')}>Продовжити пошук</Button>
        </div>}
        {searchError && <p className={styles.searchError} role="alert">{searchError}</p>}
      </section>

      {stage === 'search-ready' && <section className={styles.resultsLayout} aria-labelledby="search-results-title" aria-live="polite">
        <aside className={styles.filters}><div className={styles.filterTitle}><SlidersHorizontal size={17}/><h2>Фільтри</h2></div><Filters /></aside>
        <details className={styles.mobileFilters}><summary><span><SlidersHorizontal size={17}/>Фільтри</span><ChevronDown size={18}/></summary><Filters /></details>
        <div className={styles.resultsCard}>
          <div className={styles.resultsHeader}><h2 id="search-results-title">Результати пошуку</h2><p>{query}{deliveryRegion && ` · ${deliveryRegion}`} <span>· Знайдено постачальників: {searchResults.length}</span></p></div>
          <div className={styles.supplierList}>{searchResults.map(supplier => <SupplierCard key={supplier.id} supplier={supplier} isSelected={selectedSuppliers.includes(supplier.name)} onCompareChange={handleCompareChange} />)}</div>
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
