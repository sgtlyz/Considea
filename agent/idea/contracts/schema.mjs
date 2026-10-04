import { readFileSync } from 'node:fs';

const canonical = JSON.parse(readFileSync(new URL('../../interfaces/protocol.schema.json', import.meta.url), 'utf8'));
const extension = JSON.parse(readFileSync(new URL('./research-extension.schema.json', import.meta.url), 'utf8'));
const operations = new Set(['idea.generate', 'idea.revise']);

/** Derive Idea-only schemas; never mutate the shared contract used by other roles. */
export function schemaFor(version = '2.0') {
  if (!['2.0', '2.1'].includes(version)) throw new Error('Unsupported Idea contract version');
  const schema = structuredClone(canonical);
  schema.title = `Idea Generator contract ${version}`;
  schema.oneOf = [{ $ref: '#/$defs/Request' }, { $ref: '#/$defs/Response' }];
  schema.$defs.Request.oneOf = schema.$defs.Request.oneOf.filter(s => operations.has(s.properties.operation.const));
  schema.$defs.Response.oneOf = schema.$defs.Response.oneOf.filter(s =>
    operations.has(s.properties.operation.const) || s.properties.status.const === 'error');
  for (const response of schema.$defs.Response.oneOf) {
    if (response.properties.status.const === 'error') response.properties.operation.enum = [...operations];
  }
  if (version === '2.1') {
    Object.assign(schema.$defs, structuredClone(extension.$defs));
    for (const name of ['IdeaGenerateInput', 'IdeaReviseInput', 'IdeaGenerateData', 'IdeaReviseData']) {
      schema.$defs[name].properties.contract_version.const = version;
    }
    for (const name of ['IdeaGenerateInput', 'IdeaReviseInput']) {
      Object.assign(schema.$defs[name].properties, {
        search_policy: { $ref: '#/$defs/IdeaSearchPolicy' },
        provided_evidence: { type: 'array', maxItems: 40, items: { $ref: '#/$defs/IdeaResearchEvidence' } },
      });
      schema.$defs[name].required.push('search_policy', 'provided_evidence');
    }
    schema.$defs.CandidateDraft.properties.inspiration_refs = {
      type: 'array', items: { $ref: '#/$defs/IdeaInspirationRef' },
    };
    schema.$defs.CandidateDraft.required.push('inspiration_refs');
    for (const response of schema.$defs.Response.oneOf) {
      response.properties.research = { $ref: '#/$defs/IdeaResearchLedger' };
      response.required.push('research');
    }
  }
  return schema;
}
