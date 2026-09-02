/**
 * Response style presets — Claude "Styles" / ChatGPT "Custom instructions" equivalent.
 * Applied per conversation; appended to the system prompt at send time.
 */

export interface StylePreset {
  id: string
  label: string
  description: string
  instruction: string
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'normal',
    label: 'Normal',
    description: 'Default, balanced responses',
    instruction: '',
  },
  {
    id: 'concise',
    label: 'Concise',
    description: 'Short, direct answers — no fluff',
    instruction:
      'Response style: be concise and direct. Give the answer first, skip preamble and summaries, use short paragraphs or tight bullets. Only elaborate when asked.',
  },
  {
    id: 'formal',
    label: 'Formal',
    description: 'Polished, professional tone',
    instruction:
      'Response style: formal and professional. Clear structure, precise language, no slang or emojis. Suitable for business documents.',
  },
  {
    id: 'explanatory',
    label: 'Explanatory',
    description: 'Teach concepts step by step',
    instruction:
      'Response style: explanatory and educational. Build ideas step by step, define jargon, use analogies and examples, and check understanding at the end.',
  },
  {
    id: 'coach',
    label: 'Brainstorm coach',
    description: 'Socratic, idea-sparring partner',
    instruction:
      'Response style: act as a brainstorm partner. Offer multiple angles, challenge assumptions respectfully, ask one sharp follow-up question before giving conclusions.',
  },
  {
    id: 'engineer',
    label: 'Senior engineer',
    description: 'Code-first, production-minded',
    instruction:
      'Response style: senior software engineer. Lead with working code, note trade-offs and edge cases, prefer simple maintainable solutions, keep prose minimal.',
  },
]

export function styleInstruction(id: string | undefined): string {
  return STYLE_PRESETS.find((s) => s.id === id)?.instruction ?? ''
}
