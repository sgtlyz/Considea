import { createModels, fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai';

/** Real Pi loop, deterministic response, no credentials or network. */
export function createOfflineRuntime(responder) {
  const faux = fauxProvider();
  return {
    model: faux.getModel(),
    streamFn(model, context, options) {
      const requestFaux = fauxProvider();
      const models = createModels();
      models.setProvider(requestFaux.provider);
      requestFaux.setResponses([async ctx => {
        const message = ctx.messages.findLast(m => m.role === 'user');
        const text = typeof message.content === 'string' ? message.content
          : message.content.filter(b => b.type === 'text').map(b => b.text).join('');
        return fauxAssistantMessage(JSON.stringify(await responder(JSON.parse(text), ctx)));
      }]);
      return models.streamSimple(model, context, options);
    },
  };
}
