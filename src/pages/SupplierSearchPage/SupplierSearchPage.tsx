import '../../styles/shadcn.css';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

type SearchStage = 'idle' | 'loading' | 'clarification' | 'search-ready';

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

      <main className="mx-auto flex w-full max-w-3xl flex-1 px-5 py-12 sm:px-8 sm:py-16 lg:py-20">
        <Card className="w-full self-start border-border bg-card shadow-sm">
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

              {stage === 'search-ready' && (
                <div className="flex flex-col items-start gap-2 rounded-lg border border-border bg-slate-50 p-4 sm:p-5" role="status">
                  <Badge>Запит готовий до пошуку</Badge>
                  <p className="text-sm text-muted-foreground">Наступним кроком тут з’являться результати пошуку постачальників.</p>
                </div>
              )}
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
