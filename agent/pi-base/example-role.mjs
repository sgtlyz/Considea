import { defineRole } from './roles.mjs';
import { isObject } from './base.mjs';

// Minimal working example, not the full Interview Agent acceptance criteria.
export default defineRole('interview', {
  'interview.turn': {
    validateInput: p => typeof p.member_id === 'string' && p.member_id.length > 0 &&
      p.mode === 'initial' && Number.isInteger(p.round_index) && p.round_index >= 1 &&
      p.round_index <= 7 && Array.isArray(p.messages) && p.messages.every(m =>
        isObject(m) && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string'),
    validateOutput: (d, p) => d.member_id === p.member_id && d.mode === p.mode && d.round_index === p.round_index &&
      (p.round_index < 7 || (d.questions?.length === 0 && d.ready_to_summarize === true && d.stop_reason === 'round_limit')) &&
      Number.isInteger(d.round_index) && d.round_index >= 1 && d.round_index <= 7 &&
      Array.isArray(d.questions) && d.questions.length <= 3 && d.questions.every(q =>
        isObject(q) && ['question_id', 'text', 'purpose'].every(k => typeof q[k] === 'string')) &&
      isObject(d.coverage) && Object.values(d.coverage).every(v => ['known', 'unknown', 'declined'].includes(v)) &&
      typeof d.ready_to_summarize === 'boolean' &&
      [null, 'enough_information', 'round_limit', 'member_requested'].includes(d.stop_reason),
    outputInstructions: 'data must contain member_id, mode: initial, round_index copied from payload, questions: [{question_id,text,purpose}] (0-3), coverage: {topic: known|unknown|declined}, ready_to_summarize: boolean, stop_reason: null|enough_information|round_limit|member_requested. At round 7 stop asking and mark round_limit.',
  },
});
