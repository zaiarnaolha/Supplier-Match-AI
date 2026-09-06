import { FormEvent, useState } from 'react';
import styles from './OpenAIPocPage.module.css';

const DEFAULT_QUERY = "Шукаю постачальника кави в зернах в Україні для невеликої кав'ярні";
const DEFAULT_REGION = 'Україна';

export function OpenAIPocPage() {
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [deliveryRegion, setDeliveryRegion] = useState(DEFAULT_REGION);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);

    try {
      const response = await fetch('/api/search-suppliers-openai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, deliveryRegion }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const apiError = payload && typeof payload === 'object' && 'error' in payload
          && typeof payload.error === 'string' ? payload.error : 'OpenAI search request failed.';
        throw new Error(`HTTP ${response.status}: ${apiError}`);
      }
      setResult(payload);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'OpenAI search request failed.');
    } finally {
      setLoading(false);
    }
  }

  return <main className={styles.page}>
    <section className={styles.panel}>
      <div className={styles.heading}>
        <span className={styles.eyebrow}>Temporary POC harness</span>
        <h1>OpenAI Supplier Web Search</h1>
        <p>This isolated page calls only the OpenAI proof-of-concept endpoint.</p>
      </div>

      <form className={styles.form} onSubmit={submit}>
        <label>
          <span>Query</span>
          <textarea value={query} onChange={event => setQuery(event.target.value)} required rows={4} />
        </label>
        <label>
          <span>Delivery region</span>
          <input value={deliveryRegion} onChange={event => setDeliveryRegion(event.target.value)} required />
        </label>
        <button type="submit" disabled={loading}>
          {loading ? 'Searching…' : 'Test OpenAI Search'}
        </button>
      </form>

      {error && <div className={styles.error} role="alert">{error}</div>}
      {result !== null && <section className={styles.output} aria-live="polite">
        <h2>Structured JSON response</h2>
        <pre>{JSON.stringify(result, null, 2)}</pre>
      </section>}
    </section>
  </main>;
}
