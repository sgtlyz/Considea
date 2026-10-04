/** Conservative pre-request reservation; provider billing remains authoritative.
 * Rates verified 2026-10-03: flash peak $0.30/M input, $1.20/M output.
 * <=48KB request + 16K token framing allowance + 2048 output < $0.025.
 */
export function budgetedFetch({ store, maxCalls, maxUsd, fetch = globalThis.fetch }) {
  if (!Number.isSafeInteger(maxCalls) || maxCalls < 1 || maxCalls > 40 ||
      !Number.isFinite(maxUsd) || maxUsd < 0.025 || maxUsd > 1) throw new Error('Set finite approved call and USD limits');
  const capMicros = Math.floor(maxUsd * 1_000_000);
  return async (url, init) => {
    if (String(url) !== 'https://api.deepseek.com/v1/chat/completions' ||
        typeof init?.body !== 'string' || Buffer.byteLength(init.body, 'utf8') > 48_000) throw new Error('Request exceeds approved transport bounds');
    const p = JSON.parse(init.body);
    if (p.model !== 'deepseek-flash' || p.thinking?.type !== 'disabled' ||
        !Number.isInteger(p.max_tokens) || p.max_tokens < 1 || p.max_tokens > 2048 ||
        !Array.isArray(p.messages) || p.messages.length > 32 || p.tools?.length) throw new Error('Request exceeds approved model policy');
    const old = store.read('model-budget') ?? { calls: 0, reserved_micros: 0 };
    // Older ledgers without dollar reservations cannot safely be reused.
    if (!Number.isSafeInteger(old.calls) || old.calls < 0 || !Number.isSafeInteger(old.reserved_micros) || old.reserved_micros < 0 ||
        old.calls >= maxCalls || old.reserved_micros + 25_000 > capMicros) throw new Error('Persistent model budget exhausted');
    store.write('model-budget', { calls: old.calls + 1, reserved_micros: old.reserved_micros + 25_000 });
    // Failed and uncertain requests retain their full reservation; no retry/refund.
    return fetch(url, init);
  };
}
