import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('OpenAI POC has an isolated route and calls only its POC endpoint', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const page = await readFile(new URL('../src/pages/OpenAIPocPage/OpenAIPocPage.tsx', import.meta.url), 'utf8');

  assert.match(app, /path="\/openai-poc" element={<OpenAIPocPage \/>}/);
  assert.match(page, /fetch\('\/api\/search-suppliers-openai'/);
  assert.doesNotMatch(page, /\/api\/search-suppliers['"]/);
  assert.doesNotMatch(page, /tavily/i);
});

test('OpenAI POC exposes input, loading, error, and structured output states', async () => {
  const page = await readFile(new URL('../src/pages/OpenAIPocPage/OpenAIPocPage.tsx', import.meta.url), 'utf8');

  assert.match(page, />Query</);
  assert.match(page, />Delivery region</);
  assert.match(page, /Test OpenAI Search/);
  assert.match(page, /Searching…/);
  assert.match(page, /role="alert"/);
  assert.match(page, /JSON\.stringify\(result, null, 2\)/);
  assert.doesNotMatch(page, /MOQ|minimum order/i);
});
