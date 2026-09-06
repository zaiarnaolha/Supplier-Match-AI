import { FormEvent, useState } from 'react';
import styles from '../OpenAIPocPage/OpenAIPocPage.module.css';

export function OpenAIBatchedExperimentPage() {
  const [query, setQuery] = useState("Постачальник кави в зернах для кав'ярні");
  const [deliveryRegion, setDeliveryRegion] = useState('Україна');
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError(''); setResult(null);
    try {
      const response = await fetch('/api/search-suppliers-openai-batched', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, deliveryRegion }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`);
      setResult(payload);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Experiment failed.'); }
    finally { setLoading(false); }
  }

  return <main className={styles.page}><section className={styles.panel}>
    <div className={styles.heading}><span className={styles.eyebrow}>Isolated technical harness</span><h1>Batched OpenAI Supplier Research</h1>
      <p>Discovery followed by independent verification batches of at most three candidates. This does not use the production search provider.</p></div>
    <form className={styles.form} onSubmit={submit}>
      <label><span>Query</span><textarea value={query} onChange={event => setQuery(event.target.value)} required rows={4} /></label>
      <label><span>Delivery region</span><input value={deliveryRegion} onChange={event => setDeliveryRegion(event.target.value)} required /></label>
      <button type="submit" disabled={loading}>{loading ? 'Researching…' : 'Run batched experiment'}</button>
    </form>
    {error && <div className={styles.error} role="alert">{error}</div>}
    {result !== null && <section className={styles.output} aria-live="polite"><h2>Results and full-funnel diagnostics</h2><pre>{JSON.stringify(result, null, 2)}</pre></section>}
  </section></main>;
}
