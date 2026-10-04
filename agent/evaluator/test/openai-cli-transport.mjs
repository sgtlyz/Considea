/** Test-only preload: no request can reach a real model or search service. */
import assert from 'node:assert/strict';
import { investigation, source } from './fixtures.mjs';
import { openaiResponse } from '../../pi-base/test-fixtures/openai.mjs';

let calls = 0;
const { conclusion: _legacy, ...report } = investigation();
Object.assign(report, { capability_outcome: 'available', evidence_basis: 'official_documentation' });
const steps = [
  { name: 'search', arguments: { query: 'realtime subscription documentation' } },
  { name: 'read_source', arguments: { url: source.url } },
  { name: 'submit_report', arguments: { data: report, warnings: [] } },
];
globalThis.fetch = async (url, init) => {
  const endpoint = String(url);
  if (endpoint === 'https://api.openai.com/v1/responses') {
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer sk-offline-cli-key');
    const step = steps[calls++ % steps.length];
    return openaiResponse('', { ...step, id: String(calls) });
  }
  assert.equal(init.headers.Authorization, 'Bearer offline-tavily-key');
  if (endpoint === 'https://api.tavily.com/search')
    return Response.json({ results: [{ url: source.url, title: source.title, content: 'Official realtime documentation' }] });
  assert.equal(endpoint, 'https://api.tavily.com/extract');
  return Response.json({ results: [{ url: source.url, raw_content: 'Official documentation supports realtime subscriptions.' }], failed_results: [] });
};
