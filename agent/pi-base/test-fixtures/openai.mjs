/** Offline Responses API wire fixtures, consumed by the real Pi serializer. */
export function openaiResponse(text = '{"ok":true}', tool) {
  const item = tool
    ? { id: `fc_fixture${tool.id ?? ''}`, type: 'function_call', call_id: `call_fixture${tool.id ?? ''}`, status: 'completed',
        name: tool.name, arguments: JSON.stringify(tool.arguments) }
    : { id: 'msg_fixture', type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text, annotations: [] }] };
  const response = { id: 'resp_fixture', object: 'response', created_at: 1, status: 'completed',
    model: 'gpt-4.1-mini', output: [item], error: null, incomplete_details: null,
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15,
      input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
  const events = [
    { type: 'response.created', response: { ...response, status: 'in_progress', output: [], usage: null } },
    { type: 'response.output_item.added', output_index: 0,
      item: { ...item, status: 'in_progress', ...(tool ? { arguments: '' } : { content: [] }) } },
    tool
      ? { type: 'response.function_call_arguments.delta', output_index: 0, item_id: item.id, delta: item.arguments }
      : { type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: item.id, delta: text },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response },
  ];
  return new Response(events.map((event, sequence_number) =>
    `event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number })}\n\n`).join(''),
  { headers: { 'Content-Type': 'text/event-stream' } });
}
