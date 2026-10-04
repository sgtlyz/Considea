// Local-only syntax repair. No fields, values, quotes, commas or brackets are invented.
const MAX_CHARS = 65_536;
const MAX_CLOSERS = 256;

function tokens(text) {
  const result = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      const start = i++;
      let escaped = false;
      for (; i < text.length; i++) {
        if (escaped) escaped = false;
        else if (text[i] === '\\') escaped = true;
        else if (text[i] === '"') break;
      }
      if (i === text.length) return null;
      try { result.push({ type: 'string', value: JSON.parse(text.slice(start, i + 1)) }); }
      catch { return null; }
    } else if ('{}[],:'.includes(c)) result.push({ type: c, index: i });
  }
  return result;
}

// JSON.parse silently discards earlier duplicate properties. A syntax repair must
// not obtain a valid result by losing a fact, including escaped duplicate keys.
function duplicateKeys(text) {
  const stack = [];
  for (const token of tokens(text)) {
    const current = stack.at(-1);
    if (token.type === '{') stack.push({ keys: new Set(), expectsKey: true });
    else if (token.type === '[') stack.push(null);
    else if (token.type === '}' || token.type === ']') stack.pop();
    else if (token.type === ',' && current) current.expectsKey = true;
    else if (token.type === 'string' && current?.expectsKey) {
      if (current.keys.has(token.value)) return true;
      current.keys.add(token.value);
      current.expectsKey = false;
    }
  }
  return false;
}

/**
 * Called only after JSON.parse fails. Enumerate removal of exactly one unquoted
 * right brace. Accept one distinct raw object passing the full operation validator.
 * validate returns the normalized result or null; exceptions are not hidden.
 * Ambiguity, duplicate properties or a search beyond the budget means no repair.
 */
export function repairExtraClosingBrace(text, validate) {
  if (typeof text !== 'string' || text.length > MAX_CHARS) return null;
  const input = text.trim();
  if (!input.startsWith('{') || !input.endsWith('}')) return null;
  // Never restructure a syntactically valid output to make its contract pass.
  try { JSON.parse(input); return null; } catch { /* syntax failure only */ }
  const scanned = tokens(input);
  if (!scanned) return null;
  const positions = scanned.filter(t => t.type === '}').map(t => t.index);
  if (positions.length > MAX_CLOSERS) return null;
  let match = null, signature;
  for (const index of positions) {
    const candidate = input.slice(0, index) + input.slice(index + 1);
    let raw;
    try { raw = JSON.parse(candidate); } catch { continue; }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    if (duplicateKeys(candidate)) return null;
    const result = validate(raw);
    if (!result) continue;
    const key = JSON.stringify(raw);
    if (match && key !== signature) return null;
    match = { raw, result };
    signature = key;
  }
  return match;
}
