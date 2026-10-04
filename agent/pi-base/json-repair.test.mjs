import test from 'node:test';
import assert from 'node:assert/strict';
import { repairExtraClosingBrace } from './json-repair.mjs';

const strict = raw => Object.keys(raw).sort().join(',') === 'data,status,warnings' &&
  raw.status === 'ok' && Array.isArray(raw.warnings) && raw.warnings.every(x => typeof x === 'string') &&
  Object.keys(raw.data ?? {}).join(',') === 'items' && Array.isArray(raw.data.items) &&
  raw.data.items.every(x => Object.keys(x).join(',') === 'answer' && typeof x.answer === 'string') ? raw : null;

const value = { status: 'ok', data: { items: [{ answer: 'Keep braces } {, quote " and backslash \\ exactly' }] }, warnings: [] };
const text = JSON.stringify(value);

test('one extra brace inside arrays or at the end is removed without changing fields or strings', () => {
  for (const malformed of [text.replace('}]', '}}]'), text + '}']) {
    const repaired = repairExtraClosingBrace(malformed, strict);
    assert.deepEqual(repaired?.raw, value);
    assert.deepEqual(repaired.result, value);
  }
});

test('different valid nesting interpretations are rejected instead of guessing', () => {
  let matches = 0;
  const result = repairExtraClosingBrace('{"a":{"b":1},"c":2}}', raw => { matches++; return raw; });
  assert.equal(result, null);
  assert.ok(matches >= 2);
});

test('repair cannot silently overwrite duplicate fields, including escaped key spellings', () => {
  for (const key of ['data', 'da\\u0074a']) {
    const malformed = '{"data":{"items":[{"answer":"original"}]},"' + key + '":{"items":[]},"status":"ok","warnings":[]}}';
    assert.equal(repairExtraClosingBrace(malformed, strict), null);
  }
});

test('valid JSON, missing data, multiple extra braces and mixed syntax damage remain untouched', () => {
  for (const bad of [text, text + '}}', text.slice(0, -1), text.replace('"items":', '"items"'),
    text.replace('"warnings":[]', '"warnings":[],"approved":true') + '}',
    text.replace('"items":', '"missing":') + '}', '```json\n' + text + '}\n```']) {
    assert.equal(repairExtraClosingBrace(bad, strict), null);
  }
});

test('local repair work is bounded for large responses and many closing braces', () => {
  for (const bad of ['{"x":"' + 'a'.repeat(65_536) + '"}}', '{"x":[' + Array(257).fill('{}').join(',') + ']}}']) {
    assert.equal(repairExtraClosingBrace(bad, () => assert.fail('must not search beyond budget')), null);
  }
});
