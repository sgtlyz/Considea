import assert from 'node:assert/strict';
import test from 'node:test';
import { createVercelConfig } from '../vercel-config.mjs';

test('keeps API paths on the backend and private responses out of CDN caches', () => {
  const config = createVercelConfig('https://demo.onrender.com/');
  assert.deepEqual(config.rewrites, [
    { source: '/api/:path*', destination: 'https://demo.onrender.com/api/:path*' },
  ]);
  const headers = Object.fromEntries(config.headers[0].headers.map(({ key, value }) => [key, value]));
  assert.equal(headers['Cache-Control'], 'no-store');
  assert.equal(headers['Vercel-CDN-Cache-Control'], 'no-store');
});

test('refuses to deploy a disconnected or insecure frontend', () => {
  for (const url of [undefined, '', 'http://demo.onrender.com', 'not a url',
    'https://user:secret@demo.onrender.com', 'https://demo.onrender.com/api',
    'https://demo.onrender.com/?token=secret', 'https://demo.onrender.com/#fragment']) {
    assert.throws(() => createVercelConfig(url));
  }
});
