import { Type } from '@earendil-works/pi-ai';
import { publicUrl } from './retrieval.mjs';
import { error } from './contracts.mjs';

export function createSession(payload, { retrieval, officialDomains = [], now = () => Date.now() } = {}) {
  if (!retrieval || typeof retrieval.search !== 'function' || typeof retrieval.read !== 'function' ||
    !Array.isArray(officialDomains) || !officialDomains.every(v => typeof v === 'string' && /^[a-z0-9.-]+$/i.test(v)))
    throw error('CONFIG_ERROR', 'Provide retrieval.search/read and a valid trusted officialDomains list');
  const start = now(), budget = payload.tool_budget;
  const controllers = new Set(), discovered = new Map();
  const ledger = { evidence: [], search_log: [], incomplete: false };
  const counts = { searches: 0, reads: 0 }; let frozen = false, webId = 0;
  const official = url => {
    const host = new URL(url).hostname.toLowerCase();
    return officialDomains.some(v => host === v.toLowerCase() || host.endsWith(`.${v.toLowerCase()}`));
  };
  for (const [i, item] of payload.shared_resources.entries()) ledger.evidence.push({ evidence_id: `member-${i + 1}`,
    url: null, title: `${item.member_id}: ${item.category}`, accessed_at: new Date(start).toISOString(),
    source_kind: 'member_report', excerpt: item.text, limitation: '成员共享自述，尚未独立验证。',
    source_ref: { profile_id: item.profile_id, profile_version: item.profile_version, item_id: item.item_id, member_id: item.member_id } });
  const failure = code => { if (!frozen) ledger.incomplete = true; return { ok: false, code }; };
  const run = async (kind, fn, outerSignal) => {
    if (frozen) return failure('CANCELLED');
    if (outerSignal?.aborted) return failure('CANCELLED');
    // Reserve a final-generation window; small test/deployment budgets remain usable.
    const remaining = budget.timeout_ms - Math.min(5000, budget.timeout_ms * 0.2) - (now() - start);
    if (remaining <= 0 || counts[kind] >= budget[kind === 'searches' ? 'max_searches' : 'max_reads'])
      return failure('BUDGET_EXCEEDED');
    counts[kind]++;
    const controller = new AbortController(); controllers.add(controller);
    let timer;
    const abort = () => controller.abort(); outerSignal?.addEventListener('abort', abort, { once: true });
    try {
      const stopped = new Promise((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(error('CANCELLED', 'Cancelled')), { once: true });
        timer = setTimeout(() => { reject(error('TOOL_TIMEOUT', 'Retrieval deadline exceeded')); controller.abort(); },
          Math.max(1, Math.min(remaining, budget.per_call_timeout_ms)));
      });
      const value = await Promise.race([Promise.resolve().then(() => fn(controller.signal)), stopped]);
      if (frozen || controller.signal.aborted) return failure('CANCELLED');
      return { ok: true, value };
    } catch (e) { return failure(['TOOL_TIMEOUT', 'CANCELLED'].includes(e?.code) ? e.code : 'TOOL_UNAVAILABLE'); }
    finally { clearTimeout(timer); controllers.delete(controller); outerSignal?.removeEventListener('abort', abort); }
  };
  const search = async (query, limit = 5, signal) => {
    if (typeof query !== 'string' || !query.trim() || query.length > 400 || !Number.isInteger(limit) || limit < 1 || limit > 10)
      return failure('INVALID_QUERY');
    const r = await run('searches', s => retrieval.search(query, { limit, signal: s }), signal);
    if (!r.ok) { if (!frozen) ledger.search_log.push({ query, result_status: 'failed', error_code: r.code }); return r; }
    if (!Array.isArray(r.value?.results) || r.value.results.some(v => !publicUrl(v.url) || typeof v.title !== 'string' || typeof v.content !== 'string')) {
      ledger.search_log.push({ query, result_status: 'failed', error_code: 'TOOL_UNAVAILABLE' }); return failure('TOOL_UNAVAILABLE');
    }
    const results = r.value.results.slice(0, limit).map(v => ({ url: publicUrl(v.url), title: v.title.slice(0, 300), content: v.content.slice(0, 1500) }));
    for (const v of results) discovered.set(v.url, v.title);
    ledger.search_log.push({ query, result_status: results.length ? 'results' : 'no_results' });
    return { ok: true, results };
  };
  const read = async (value, signal) => {
    const url = publicUrl(value);
    if (!url || (!discovered.has(url) && !official(url))) return failure('INVALID_SOURCE');
    const r = await run('reads', s => retrieval.read(url, { signal: s }), signal);
    if (!r.ok) return r;
    if (publicUrl(r.value?.url) !== url || typeof r.value?.content !== 'string' || !r.value.content.trim()) return failure('TOOL_UNAVAILABLE');
    const evidence = { evidence_id: `web-${++webId}`, url,
      title: discovered.get(url) || (typeof r.value.title === 'string' && r.value.title) || new URL(url).hostname,
      accessed_at: new Date(now()).toISOString(), source_kind: official(url) ? 'official_documentation' : 'project_self_report',
      excerpt: r.value.content.slice(0, 16000), limitation: official(url) ? '文档能力未做实际接入测试。' : '项目公开自述，未独立运行验证。' };
    ledger.evidence.push(evidence); return { ok: true, evidence };
  };
  const wrap = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], details: {} });
  return { search, read, snapshot: () => structuredClone(ledger),
    markIncomplete: () => { ledger.incomplete = true; },
    freeze: () => { frozen = true; for (const c of controllers) c.abort(); },
    tools: [
      { name: 'search', label: '搜索公开来源', description: 'Discover sources. Snippets are leads, not evidence for a verified claim.',
        parameters: Type.Object({ query: Type.String({ minLength: 1, maxLength: 400 }), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })) }),
        execute: async (_id, args, signal) => wrap(await search(args.query, args.limit ?? 5, signal)) },
      { name: 'read_source', label: '读取来源正文', description: 'Read a discovered URL or trusted official domain and register evidence.',
        parameters: Type.Object({ url: Type.String() }), execute: async (_id, args, signal) => wrap(await read(args.url, signal)) },
    ],
  };
}
