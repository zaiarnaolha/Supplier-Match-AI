import '../../styles/shadcn.css';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

export function SupplierSearchPage() {
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
          <CardContent className="space-y-5 p-6 pt-0 sm:p-8 sm:pt-0">
            <Textarea
              className="min-h-36 resize-y bg-background px-4 py-3 text-base leading-relaxed"
              placeholder="Наприклад: шукаю постачальника бакалії з доставкою до Коломиї"
              aria-label="Опишіть потребу в постачальнику"
            />
            <Button className="h-11 w-full px-6 sm:w-auto" type="button">Знайти постачальників</Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
