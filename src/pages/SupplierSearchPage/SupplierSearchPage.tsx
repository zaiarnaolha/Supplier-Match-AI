import '../../styles/shadcn.css';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

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
  {
    name: 'Coffee Trade Ukraine',
    location: 'Київ, Україна',
    match: '92% Match',
    breakdown: '3 критерії відповідають · 1 частково',
    updatedAt: '12 серпня 2026',
    criteria: [
      { label: 'Товар', value: 'кава та кавова продукція', status: 'Відповідає' },
      { label: 'Регіон доставки', value: 'Україна', status: 'Відповідає' },
      { label: 'MOQ', value: 'від 10 кг', status: 'Відповідає' },
      { label: 'Ціна', value: 'від 320 грн/кг', status: 'Частково відповідає' },
    ],
  },
  {
    name: 'Bean Supply Europe',
    location: 'Львів, Україна',
    match: '78% Match',
    breakdown: '2 критерії відповідають · 2 частково',
    updatedAt: '8 серпня 2026',
    criteria: [
      { label: 'Товар', value: 'кава в зернах', status: 'Відповідає' },
      { label: 'Регіон доставки', value: 'Україна', status: 'Відповідає' },
      { label: 'MOQ', value: 'від 50 кг', status: 'Частково відповідає' },
      { label: 'Ціна', value: 'від 290 грн/кг', status: 'Частково відповідає' },
    ],
  },
  {
    name: 'Roast Partners',
    location: 'Краків, Польща',
    match: '64% Match',
    breakdown: '2 критерії відповідають · 2 без даних',
    updatedAt: '28 липня 2026',
    criteria: [
      { label: 'Товар', value: 'кава та обсмажене зерно', status: 'Відповідає' },
      { label: 'Регіон доставки', value: 'Україна', status: 'Відповідає' },
      { label: 'MOQ', value: 'Не вказано', status: 'Немає даних' },
      { label: 'Ціна', value: 'Не вказано', status: 'Немає даних' },
    ],
  },
];

function statusClassName(status: CriterionStatus) {
  if (status === 'Відповідає') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'Частково відповідає') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-slate-200 bg-slate-100 text-slate-600';
}

function SupplierCard({ supplier }: { supplier: Supplier }) {
  const checkboxId = `compare-${supplier.name.toLowerCase().replace(/\s+/g, '-')}`;

  return (
    <Card className="min-w-0 overflow-hidden border-border bg-card shadow-sm">
      <CardHeader className="gap-4 p-5 sm:p-6">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <CardTitle className="break-words text-xl leading-snug">{supplier.name}</CardTitle>
            <p className="text-sm text-muted-foreground">{supplier.location}</p>
          </div>
          <Badge className="shrink-0 self-start">{supplier.match}</Badge>
        </div>
        <p className="text-sm font-medium text-foreground">{supplier.breakdown}</p>
      </CardHeader>

      <CardContent className="space-y-5 p-5 pt-0 sm:p-6 sm:pt-0">
        <dl className="divide-y divide-border rounded-lg border border-border">
          {supplier.criteria.map((criterion) => (
            <div className="grid min-w-0 gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4" key={criterion.label}>
              <div className="min-w-0 break-words text-sm">
                <dt className="inline font-medium">{criterion.label}: </dt>
                <dd className="inline text-muted-foreground">{criterion.value}</dd>
              </div>
              <Badge className={cn('w-fit max-w-full whitespace-normal text-left', statusClassName(criterion.status))} variant="outline">{criterion.status}</Badge>
            </div>
          ))}
        </dl>

        <p className="text-xs text-muted-foreground">Оновлено: {supplier.updatedAt}</p>

        <div className="flex flex-col gap-4 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex min-w-0 cursor-pointer items-start gap-2.5 text-sm" htmlFor={checkboxId}>
            <Checkbox className="mt-0.5" id={checkboxId} />
            <span className="break-words">Додати до порівняння</span>
          </label>
          <Button className="w-full shrink-0 sm:w-auto" type="button" variant="outline">Переглянути постачальника</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function isSpecificRequest(query: string) {
  const normalizedQuery = query.trim();
  return normalizedQuery.length >= 25 && normalizedQuery.split(/\s+/).length >= 5;
}

export function SupplierSearchPage() {
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState<SearchStage>('idle');
  const [deliveryRegion, setDeliveryRegion] = useState('');
  const loadingTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (loadingTimer.current !== null) window.clearTimeout(loadingTimer.current);
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!query.trim() || stage === 'loading') return;

    setStage('loading');
    loadingTimer.current = window.setTimeout(() => {
      setStage(isSpecificRequest(query) ? 'search-ready' : 'clarification');
      loadingTimer.current = null;
    }, 700);
  }

  return (
    <div className="shadcn min-h-screen bg-slate-50 text-foreground">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
          <Link className="flex items-center gap-2.5 font-semibold tracking-tight" to="/app" aria-label="Supplier Match AI">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground" aria-hidden="true">S</span>
            <span>Supplier Match AI</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-5 py-12 sm:px-8 sm:py-16 lg:py-20">
        <Card className="mx-auto w-full max-w-3xl self-start border-border bg-card shadow-sm">
          <CardHeader className="p-6 pb-5 sm:p-8 sm:pb-6">
            <CardTitle className="text-2xl leading-tight tracking-tight sm:text-3xl">Опишіть, що вам потрібно знайти</CardTitle>
          </CardHeader>
          <CardContent className="p-6 pt-0 sm:p-8 sm:pt-0">
            <form className="space-y-5" onSubmit={handleSubmit}>
              <Textarea
                className="min-h-36 resize-y bg-background px-4 py-3 text-base leading-relaxed"
                placeholder="Наприклад: шукаю постачальника бакалії з доставкою до Коломиї"
                aria-label="Опишіть потребу в постачальнику"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                disabled={stage === 'loading' || stage === 'search-ready'}
              />

              {(stage === 'idle' || stage === 'loading') && (
                <Button className="h-11 w-full px-6 sm:w-auto" type="submit" disabled={!query.trim() || stage === 'loading'}>
                  {stage === 'loading' ? 'Аналізуємо ваш запит…' : 'Знайти постачальників'}
                </Button>
              )}

              {stage === 'clarification' && (
                <div className="space-y-4 rounded-lg border border-border bg-slate-50 p-4 sm:p-5">
                  <div className="space-y-1.5">
                    <p className="text-sm text-muted-foreground">Щоб знайти релевантніші варіанти, уточніть:</p>
                    <p className="font-medium">Де ви плануєте отримувати товар?</p>
                  </div>
                  <Select value={deliveryRegion} onValueChange={setDeliveryRegion}>
                    <SelectTrigger className="bg-background" aria-label="Регіон отримання товару">
                      <SelectValue placeholder="Оберіть регіон" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ukraine">Україна</SelectItem>
                      <SelectItem value="europe">Європа</SelectItem>
                      <SelectItem value="asia">Азія</SelectItem>
                      <SelectItem value="anywhere">Будь-яка країна</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button className="h-11 w-full px-6 sm:w-auto" type="button" disabled={!deliveryRegion} onClick={() => setStage('search-ready')}>Продовжити пошук</Button>
                </div>
              )}

            </form>
          </CardContent>
        </Card>

        {stage === 'search-ready' && (
          <section className="min-w-0 space-y-6" aria-labelledby="search-results-title" aria-live="polite">
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl" id="search-results-title">Результати пошуку</h2>
              <p className="text-base font-medium">Кава · Україна</p>
              <p className="text-sm text-muted-foreground">Знайдено 3 постачальники</p>
            </div>
            <div className="grid min-w-0 gap-5">
              {suppliers.map((supplier) => <SupplierCard key={supplier.name} supplier={supplier} />)}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
