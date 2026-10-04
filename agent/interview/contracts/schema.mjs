import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

// Immutable upstream snapshot. 2.1 extends Interview only; master 2.0 is unchanged.
export const upstream = JSON.parse(readFileSync(new URL('./protocol-v2.0.schema.json', import.meta.url), 'utf8'));
export const extended = structuredClone(upstream);
const defs = extended.$defs;
const ref = name => ({ $ref: `#/$defs/${name}` });
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const text = { type: 'string', minLength: 1 };
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
defs.InterviewDecisionResult = object({
  decision_ref: ref('Ref'), discussion_round: { type: 'integer', minimum: 1 },
  decision: { enum: ['continue_interview', 'diverge'] }, conclusion: text,
  source_ids: { type: 'array', items: text, minItems: 1, uniqueItems: true },
});
defs.InterviewEvaluation = object({
  ...defs.StoredEvaluation.properties,
  feasibility: object({ verdict: { enum: ['feasible', 'infeasible', 'conditional', 'unknown'] }, rationale: text }),
});
defs.FollowupContext = object({
  ...defs.FollowupContext.properties,
  difference: nullable(ref('StoredDifference')),
  answers: { type: 'array', items: ref('Answer') },
  decision_result: nullable(ref('InterviewDecisionResult')),
  candidate: nullable(ref('Candidate')),
  evaluation: nullable(ref('InterviewEvaluation')),
});
for (const name of ['InterviewTurnInput', 'InterviewSummarizeInput', 'InterviewTurnData', 'InterviewSummarizeData']) {
  defs[name].properties.contract_version = { const: '2.1' };
}
const ajv = new Ajv({ strict: false, allErrors: false });
addFormats(ajv);
const validators = new Map();
for (const [version, schema] of [['2.0', upstream], ['2.1', extended]]) {
  for (const name of ['InterviewTurnInput', 'InterviewSummarizeInput', 'InterviewTurnData', 'InterviewSummarizeData']) {
    validators.set(`${version}:${name}`, ajv.compile({ $schema: schema.$schema, $defs: schema.$defs, ...ref(name) }));
  }
}
export const validateShape = (name, value, version = value?.contract_version) =>
  validators.get(`${version}:${name}`)?.(value) === true;

/** Resolve only the output definition; do not send the entire input protocol to the model. */
export function outputShape(name, version) {
  const schema = version === '2.1' ? extended : upstream;
  const resolve = value => {
    if (Array.isArray(value)) return value.map(resolve);
    if (!value || typeof value !== 'object') return value;
    if (value.$ref) return resolve(schema.$defs[value.$ref.split('/').at(-1)]);
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v)]));
  };
  return resolve(schema.$defs[name]);
}

// Return schema locations/keywords only, never private values or raw AJV messages.
export function shapeIssues(name, value, version) {
  const validator = validators.get(`${version}:${name}`);
  if (!validator) return [{ code: 'CONTRACT_VERSION', path: '/contract_version' }];
  if (validator(value)) return [];
  return validator.errors.slice(0, 8).map(e => ({ code: 'SCHEMA_' + e.keyword.toUpperCase(), path: e.instancePath || '/' }));
}
