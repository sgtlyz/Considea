import { createModels, fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';

/** Actual Pi loop with deterministic fake model responses. Never accesses credentials or network. */
export function createOfflineRuntime(responses) {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses(responses);
  return { model: faux.getModel(), streamFn: models.streamSimple.bind(models) };
}
export const finalMessage = data => fauxAssistantMessage(JSON.stringify({ status: 'ok', data, warnings: ['OFFLINE MOCK: fabricated outputs and sources; no live model or search.'] }));
export const callTools = calls => fauxAssistantMessage(calls.map(([name, args], i) => fauxToolCall(name, args, { id: `call-${i}` })), { stopReason: 'toolUse' });
