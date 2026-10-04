import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { error, object } from './contracts.mjs';

export function publicUrl(value) {
  try {
    const u = new URL(value);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password ||
      u.hostname === 'localhost' || u.hostname.endsWith('.localhost') || !u.hostname.includes('.') ||
      /^(?:127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(u.hostname)) return null;
    u.hash = ''; return u.href;
  } catch { return null; }
}
const unavailable = () => error('TOOL_UNAVAILABLE', 'Retrieval service failed or returned an invalid result');
function domainFilter(includeDomains) {
  if (includeDomains === undefined) return {};
  if (!Array.isArray(includeDomains) || includeDomains.length === 0 ||
    !includeDomains.every(v => typeof v === 'string' && /^[a-z0-9.-]+$/i.test(v)))
    throw error('CONFIG_ERROR', 'Invalid retrieval domain filter');
  return { include_domains: includeDomains };
}
function searchResult(body) {
  if (!object(body) || !Array.isArray(body.results)) throw unavailable();
  const results = body.results.filter(v => object(v) && publicUrl(v.url) && typeof v.title === 'string' && typeof v.content === 'string')
    .map(v => ({ url: publicUrl(v.url), title: v.title.slice(0, 300), content: v.content.slice(0, 1500) }));
  if (body.results.length && !results.length) throw unavailable();
  return { results };
}
function readResult(body, url) {
  const v = body?.results?.find(v => object(v) && publicUrl(v.url) === url && typeof v.raw_content === 'string' && v.raw_content.trim());
  if (!v) throw unavailable();
  return { url, title: typeof v.title === 'string' ? v.title.slice(0, 300) : new URL(url).hostname,
    content: v.raw_content.slice(0, 16000) };
}

export function createTavilyApi({ apiKey, fetchFn = fetch } = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim() || typeof fetchFn !== 'function')
    throw error('CONFIG_ERROR', 'TAVILY_API_KEY is required for Tavily API transport');
  const post = async (path, body, signal) => {
    try {
      const response = await fetchFn(`https://api.tavily.com/${path}`, { method: 'POST', signal,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) throw unavailable();
      // Bound allocation even if the upstream returns a malformed or unexpectedly large response.
      const reader = response.body.getReader(); const chunks = []; let bytes = 0;
      try {
        for (;;) { const { done, value } = await reader.read(); if (done) break;
          bytes += value.byteLength; if (bytes > 2_000_000) throw unavailable(); chunks.push(value); }
      } finally { await reader.cancel().catch(() => {}); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { throw unavailable(); }
  };
  return {
    async search(query, { limit = 5, signal, includeDomains } = {}) {
      return searchResult(await post('search', { query, max_results: limit, search_depth: 'basic', ...domainFilter(includeDomains) }, signal));
    },
    async read(value, { signal } = {}) {
      const url = publicUrl(value); if (!url) throw error('INVALID_SOURCE', 'Only public HTTP(S) sources are accepted');
      return readResult(await post('extract', { urls: [url], extract_depth: 'basic' }, signal), url);
    },
  };
}

export function createTavilyCli({ executable = 'tvly', argsPrefix = [], pythonExecutable } = {}) {
  if (typeof executable !== 'string' || !executable || !Array.isArray(argsPrefix) || !argsPrefix.every(v => typeof v === 'string'))
    throw error('CONFIG_ERROR', 'Invalid Tavily executable configuration');
  if (pythonExecutable !== undefined) {
    if (typeof pythonExecutable !== 'string' || !pythonExecutable) throw error('CONFIG_ERROR', 'Invalid Tavily Python executable');
    executable = pythonExecutable;
    argsPrefix = [fileURLToPath(new URL('./tavily_cli_compat.py', import.meta.url)), ...argsPrefix];
  }
  const call = (args, signal) => new Promise((resolve, reject) => {
    // Executable and prefix are server configuration; request text is passed only as an argument.
    execFile(executable, [...argsPrefix, ...args, '--json'], { shell: false, windowsHide: true, signal,
      timeout: 30000, maxBuffer: 2_000_000, encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } },
    (err, stdout) => {
      if (err) return reject(unavailable());
      try { resolve(JSON.parse(stdout)); } catch { reject(unavailable()); }
    });
  });
  return {
    async search(query, { limit = 5, signal, includeDomains } = {}) {
      const filter = domainFilter(includeDomains);
      return searchResult(await call(['search', query, '--max-results', String(limit), '--depth', 'basic',
        ...(filter.include_domains ? ['--include-domains', filter.include_domains.join(',')] : [])], signal));
    },
    async read(value, { signal } = {}) {
      const url = publicUrl(value); if (!url) throw error('INVALID_SOURCE', 'Only public HTTP(S) sources are accepted');
      // Do not send extract timeout/chunks flags: the installed CLI's MCP backend rejects them.
      return readResult(await call(['extract', url], signal), url);
    },
  };
}
