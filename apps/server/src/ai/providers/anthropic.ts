import { type LlmProvider, type LlmRequest, type LlmResponse, type ProviderOptions, parseArgs, postJson } from './types.ts';

type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string };

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: Block[];
}

/** Anthropic Messages API with tool use. */
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic' as const;
  readonly model: string;
  private opts: ProviderOptions;

  constructor(opts: ProviderOptions) {
    this.opts = opts;
    this.model = opts.model;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const messages: AnthropicMessage[] = [];
    // The API requires alternating roles, so consecutive blocks of the same role are merged.
    const push = (role: 'user' | 'assistant', blocks: Block[]) => {
      if (!blocks.length) return;
      const last = messages.at(-1);
      if (last?.role === role) last.content.push(...blocks);
      else messages.push({ role, content: blocks });
    };
    for (const m of req.messages) {
      if (m.role === 'user') push('user', [{ type: 'text', text: m.content }]);
      else if (m.role === 'assistant') {
        const blocks: Block[] = [];
        if (m.content) blocks.push({ type: 'text', text: m.content });
        for (const tc of m.toolCalls ?? []) blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args });
        push('assistant', blocks);
      } else push('user', [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }]);
    }
    const body: Record<string, unknown> = { model: this.model, max_tokens: 2048, system: req.system, messages };
    if (req.tools.length) body.tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    const data = (await postJson(
      this.opts,
      `${this.opts.baseUrl}/messages`,
      { 'x-api-key': this.opts.apiKey ?? '', 'anthropic-version': '2023-06-01' },
      body,
      'Anthropic',
    )) as { content?: { type: string; text?: string; id?: string; name?: string; input?: unknown }[] };
    if (!Array.isArray(data.content)) throw new Error('Anthropic API returned no content');
    const text = data.content
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text)
      .join('\n');
    return {
      text: text || null,
      toolCalls: data.content.filter((b) => b.type === 'tool_use' && b.id && b.name).map((b) => ({ id: b.id!, name: b.name!, args: parseArgs(b.input) })),
    };
  }
}
