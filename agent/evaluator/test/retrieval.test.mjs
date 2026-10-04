import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createTavilyApi, createTavilyCli } from '../retrieval.mjs';

test('HTTP transport sends search and extraction bodies and normalizes results', async () => {
  const calls = [];
  const client = createTavilyApi({ apiKey: 'fixture-secret', fetchFn: async (url, options) => {
    calls.push({ url, options }); return Response.json(url.endsWith('/search') ?
      { results: [{ url: 'https://example.com', title: '标题', content: '片段' }] } :
      { results: [{ url: 'https://example.com', raw_content: '实际正文' }], failed_results: [] });
  } });
  assert.equal((await client.search('test', { limit: 2 })).results[0].content, '片段');
  assert.equal((await client.read('https://example.com')).content, '实际正文');
  assert.equal(calls[0].url, 'https://api.tavily.com/search');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer fixture-secret');
  assert.deepEqual(JSON.parse(calls[0].options.body), { query: 'test', max_results: 2, search_depth: 'basic' });
  assert.deepEqual(JSON.parse(calls[1].options.body), { urls: ['https://example.com/'], extract_depth: 'basic' });
});
test('transport refuses malformed search, extraction failure and unsafe URL without exposing provider errors', async () => {
  for (const body of [{ results: null }, { failed_results: [{ error: 'secret' }], results: [] }]) {
    const c = createTavilyApi({ apiKey: 'secret', fetchFn: async () => Response.json(body) });
    await assert.rejects(c.read('https://example.com'), e => e.code === 'TOOL_UNAVAILABLE' && !e.message.includes('secret'));
  }
  const c = createTavilyApi({ apiKey: 'secret', fetchFn: async () => { throw new Error('secret'); } });
  await assert.rejects(c.search('test'), e => !e.message.includes('secret'));
  await assert.rejects(c.read('file:///private'));
  assert.throws(() => createTavilyApi({}), { code: 'CONFIG_ERROR' });
});
test('CLI adapter uses argument array, UTF8 and real subprocess parsing without shell expansion', async () => {
  const c = createTavilyCli({ executable: process.execPath,
    argsPrefix: [fileURLToPath(new URL('./cli-fixture.mjs', import.meta.url))] });
  const query = '中文 $(echo SECRET)';
  const result = await c.search(query, { limit: 2 });
  assert.equal(result.results[0].title, query); assert.equal(result.results[0].content, 'UTF8：utf-8');
  assert.equal((await c.read('https://example.com')).content, '正文');
});
