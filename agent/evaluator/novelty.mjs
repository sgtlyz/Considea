/** Required discovery scopes. Search coverage is separate from source-body evidence. */
export const NOVELTY_SCOPES = Object.freeze([
  Object.freeze({ scope: 'github', domain: 'github.com', site: 'github.com', label: 'GitHub repositories' }),
  Object.freeze({ scope: 'devpost', domain: 'devpost.com', site: 'devpost.com/software', label: 'Devpost hackathon projects' }),
]);

const githubDirectories = new Set(['topics', 'collections', 'trending', 'search', 'users', 'orgs', 'marketplace',
  'features', 'settings', 'explore', 'sponsors', 'login', 'signup', 'about', 'enterprise', 'pricing', 'security', 'site',
  'solutions', 'readme', 'customer-stories', 'resources', 'events', 'apps', 'copilot', 'codespaces', 'partners',
  'education', 'accelerator', 'issues', 'pulls', 'discussions', 'notifications', 'organizations', 'new']);
const devpostDirectories = new Set(['search', 'new', 'edit', 'popular', 'trending']);

export function isScopedProjectUrl(value, scope) {
  try {
    const u = new URL(value), path = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.port) return false;
    if (scope === 'github') return ['github.com', 'www.github.com'].includes(u.hostname) && path.length >= 2 &&
      /^[a-z0-9-]+$/i.test(path[0]) && /^[a-z0-9_.-]+$/i.test(path[1]) && !githubDirectories.has(path[0].toLowerCase());
    if (scope === 'devpost') return ['devpost.com', 'www.devpost.com'].includes(u.hostname) && path[0] === 'software' &&
      path.length >= 2 && !devpostDirectories.has(path[1].toLowerCase());
    return false;
  } catch { return false; }
}

export function noveltyCoverage(searchLog = []) {
  const scopes = NOVELTY_SCOPES.map(({ scope }) => {
    const attempts = searchLog.filter(v => v.scope === scope && v.executed === true);
    const successful = attempts.filter(v => ['results', 'no_results'].includes(v.result_status));
    return { scope, status: successful.some(v => v.result_status === 'results') ? 'results' :
      successful.length ? 'no_results' : attempts.length ? 'failed' : 'not_searched',
      attempts: attempts.length, result_count: successful.reduce((sum, v) => sum + (v.result_count ?? 0), 0) };
  });
  return { required_scopes: NOVELTY_SCOPES.map(v => v.scope),
    complete: scopes.every(v => ['results', 'no_results'].includes(v.status)), scopes };
}

export function missingNoveltyChecks(coverage) {
  return coverage.scopes.filter(v => !['results', 'no_results'].includes(v.status))
    .map(v => `Complete the required ${NOVELTY_SCOPES.find(s => s.scope === v.scope).label} search (${v.status}).`);
}
