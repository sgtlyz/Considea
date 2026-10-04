import { Type } from '@earendil-works/pi-ai';
import { publicUrl } from './retrieval.mjs';
import { error } from './contracts.mjs';
import { NOVELTY_SCOPES, isScopedProjectUrl, noveltyCoverage } from './novelty.mjs';

export function createSession(payload, { retrieval, officialDomains = [], now = () => Date.now() } = {}) {
  if (!retrieval || typeof retrieval.search !== 'function' || typeof retrieval.read !== 'function' ||
    !Array.isArray(officialDomains) || !officialDomains.every(v => typeof v === 'string' && /^[a-z0-9.-]+$/i.test(v)))
    throw error('CONFIG_ERROR', 'Provide retrieval.search/read and a valid trusted officialDomains list');
  const start = now(), budget = payload.tool_budget;
  const controllers = new Set(), discovered = new Map(), reservedScopes = new Set();
  const ledger = { evidence: [], search_log: [], incomplete: false };
  const counts = { searches: 0, reads: 0 }; let frozen = false, webId = 0;
  const official = url => {
    const host = new URL(url).hostname.toLowerCase();
    return officialDomains.some(v => host === v.toLowerCase() || host.endsWith(`.${v.toLowerCase()}`));
  };
  for (const [i, item] of payload.shared_resources.entries()) ledger.evidence.push({ evidence_id: `member-${i + 1}`,
    url: null, title: `${item.member_id}: ${item.category}`, accessed_at: new Date(start).toISOString(),
    source_kind: 'member_report', excerpt: item.text, limitation: 'Shared member self-report; not independently verified.',
    source_ref: { profile_id: item.profile_id, profile_version: item.profile_version, item_id: item.item_id, member_id: item.member_id } });
  const failure = code => { if (!frozen) ledger.incomplete = true; return { ok: false, code }; };
  const run = async (kind, fn, outerSignal) => {
    if (frozen) return { ...failure('CANCELLED'), executed: false };
    if (outerSignal?.aborted) return { ...failure('CANCELLED'), executed: false };
    // Reserve a final-generation window; small test/deployment budgets remain usable.
    const remaining = budget.timeout_ms - Math.min(5000, budget.timeout_ms * 0.2) - (now() - start);
    if (remaining <= 0 || counts[kind] >= budget[kind === 'searches' ? 'max_searches' : 'max_reads'])
      return { ...failure('BUDGET_EXCEEDED'), executed: false };
    counts[kind]++;
    const controller = new AbortController(); controllers.add(controller);
    let timer, executed = false;
    const abort = () => controller.abort(); outerSignal?.addEventListener('abort', abort, { once: true });
    try {
      const stopped = new Promise((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(error('CANCELLED', 'Cancelled')), { once: true });
        timer = setTimeout(() => { reject(error('TOOL_TIMEOUT', 'Retrieval deadline exceeded')); controller.abort(); },
          Math.max(1, Math.min(remaining, budget.per_call_timeout_ms)));
      });
      const value = await Promise.race([Promise.resolve().then(() => { executed = true; return fn(controller.signal); }), stopped]);
      if (frozen || controller.signal.aborted) return { ...failure('CANCELLED'), executed };
      return { ok: true, value, executed };
    } catch (e) { return { ...failure(['TOOL_TIMEOUT', 'CANCELLED'].includes(e?.code) ? e.code : 'TOOL_UNAVAILABLE'), executed }; }
    finally { clearTimeout(timer); controllers.delete(controller); outerSignal?.removeEventListener('abort', abort); }
  };
  const search = async (query, limit = 5, signal, requestedScope) => {
    if (typeof query !== 'string' || !query.trim() || query.length > 400 || !Number.isInteger(limit) || limit < 1 || limit > 10 ||
      (requestedScope !== undefined && !['github', 'devpost', 'web'].includes(requestedScope)))
      return failure('INVALID_QUERY');
    const pending = payload.question ? [] : NOVELTY_SCOPES.filter(v => !reservedScopes.has(v.scope) &&
      !ledger.search_log.some(log => log.scope === v.scope && log.executed === true));
    const scope = payload.question ? 'web' : pending.find(v => v.scope === requestedScope)?.scope ??
      pending[0]?.scope ?? requestedScope ?? 'web';
    const target = NOVELTY_SCOPES.find(v => v.scope === scope);
    if (target) {
      const terms = query.replace(/-?\bsite:\S+/gi, '').replace(/\bOR\b/g, ' ').trim() ||
        `${payload.candidate.problem} ${payload.candidate.core_flow.join(' ')}`;
      const prefix = scope === 'devpost' ? 'hackathon ' : '';
      query = `${prefix}${terms.slice(0, 400 - prefix.length - target.site.length - 6).trim()} site:${target.site}`;
    }
    reservedScopes.add(scope);
    const r = await run('searches', s => retrieval.search(query, { limit, signal: s,
      ...(target ? { includeDomains: [target.domain] } : {}) }), signal);
    reservedScopes.delete(scope);
    const log = { query, scope, executed: r.executed === true, result_count: 0, excluded_count: 0, result_urls: [] };
    if (!r.ok) { if (!frozen) ledger.search_log.push({ ...log, result_status: 'failed', error_code: r.code }); return { ...r, scope, query }; }
    if (!Array.isArray(r.value?.results) || r.value.results.some(v => !publicUrl(v.url) || typeof v.title !== 'string' || typeof v.content !== 'string')) {
      ledger.search_log.push({ ...log, result_status: 'failed', error_code: 'TOOL_UNAVAILABLE' }); return failure('TOOL_UNAVAILABLE');
    }
    const eligible = r.value.results.filter(v => !target || isScopedProjectUrl(v.url, scope));
    log.excluded_count = r.value.results.length - eligible.length;
    // A provider that ignored the requested scope has not established an empty project search.
    if (r.value.results.length && !eligible.length) {
      ledger.search_log.push({ ...log, result_status: 'failed', error_code: 'SOURCE_SCOPE_MISMATCH' });
      return { ...failure('SOURCE_SCOPE_MISMATCH'), scope, query };
    }
    const results = eligible.slice(0, limit).map(v => ({ url: publicUrl(v.url), title: v.title.slice(0, 300), content: v.content.slice(0, 1500) }));
    for (const v of results) discovered.set(v.url, v.title);
    ledger.search_log.push({ ...log, result_count: results.length, result_urls: results.map(v => v.url),
      result_status: results.length ? 'results' : 'no_results' });
    return { ok: true, scope, query, results, ...(payload.question ? {} : { novelty_coverage: noveltyCoverage(ledger.search_log) }) };
  };
  const read = async (value, signal) => {
    const url = publicUrl(value);
    if (!url || (!discovered.has(url) && !official(url))) return failure('INVALID_SOURCE');
    const r = await run('reads', s => retrieval.read(url, { signal: s }), signal);
    if (!r.ok) return r;
    if (publicUrl(r.value?.url) !== url || typeof r.value?.content !== 'string' || !r.value.content.trim()) return failure('TOOL_UNAVAILABLE');
    const evidence = { evidence_id: `web-${++webId}`, url,
      title: discovered.get(url) || (typeof r.value.title === 'string' && r.value.title) || new URL(url).hostname,
      accessed_at: new Date(now()).toISOString(), source_kind: official(url) ? 'official_documentation' : 'public_web',
      excerpt: r.value.content.slice(0, 16000), limitation: official(url) ? 'Documented capability; no integration test was executed.' : 'Public web content; authorship and project implementation were not independently verified.' };
    ledger.evidence.push(evidence); return { ok: true, evidence };
  };
  const wrap = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], details: {} });
  return { search, read, snapshot: () => structuredClone(ledger),
    markIncomplete: () => { ledger.incomplete = true; },
    freeze: () => { frozen = true; for (const c of controllers) c.abort(); },
    tools: [
      { name: 'search', label: 'Search public sources', description: payload.question ?
        'Discover authoritative sources for the supplied investigation.' :
        'Discover projects. The first two evaluation searches prioritize distinct GitHub repository and Devpost hackathon project scopes. Choose meaningful target-user, problem and solution keywords; scope=web is available after both attempts. Snippets are discovery leads, not body evidence.',
        parameters: Type.Object({ query: Type.String({ minLength: 1, maxLength: 400 }), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
          scope: Type.Optional(Type.Union(['github', 'devpost', 'web'].map(v => Type.Literal(v)))) }),
        execute: async (_id, args, signal) => wrap(await search(args.query, args.limit ?? 5, signal, args.scope)) },
      { name: 'read_source', label: 'Read source body', description: 'Read a discovered URL or trusted official domain and register evidence.',
        parameters: Type.Object({ url: Type.String() }), execute: async (_id, args, signal) => wrap(await read(args.url, signal)) },
    ],
  };
}
