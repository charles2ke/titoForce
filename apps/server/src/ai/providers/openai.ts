import { type LlmProvider, type LlmRequest, type LlmResponse, type ProviderOptions, parseArgs, postJson } from './types.ts';

interface OpenAiToolCall {
  id: string;
  type?: string;
  function?: { name: string; arguments: string };
}

/** OpenAI Chat Completions API (also works with OpenAI-compatible servers such as Azure OpenAI proxies, Ollama, vLLM). */
export class OpenAiProvider implements LlmProvider {
  readonly name = 'openai' as const;
  readonly model: string;
  private opts: ProviderOptions;

  constructor(opts: ProviderOptions) {
    this.opts = opts;
    this.model = opts.model;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const messages: unknown[] = [{ role: 'system', content: req.system }];
    for (const m of req.messages) {
      if (m.role === 'user') messages.push({ role: 'user', content: m.content });
      else if (m.role === 'assistant') {
        messages.push({
          role: 'assistant',
          content: m.content ?? null,
          ...(m.toolCalls?.length
            ? { tool_calls: m.toolCalls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args) } })) }
            : {}),
        });
      } else messages.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
    }
    const body: Record<string, unknown> = { model: this.model, messages };
    if (req.tools.length) {
      body.tools = req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
      body.tool_choice = 'auto';
    }
    const headers: Record<string, string> = this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {};
    const data = (await postJson(this.opts, `${this.opts.baseUrl}/chat/completions`, headers, body, 'OpenAI')) as {
      choices?: { message?: { content?: string | null; tool_calls?: OpenAiToolCall[] } }[];
    };
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error('OpenAI API returned no message');
    return {
      text: msg.content ?? null,
      toolCalls: (msg.tool_calls ?? [])
        .filter((tc) => tc.function?.name)
        .map((tc) => ({ id: tc.id, name: tc.function!.name, args: parseArgs(tc.function!.arguments) })),
    };
  }
}
