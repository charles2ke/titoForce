export interface LlmToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type LlmMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: LlmToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface LlmTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LlmRequest {
  system: string;
  messages: LlmMessage[];
  tools: LlmTool[];
}

export interface LlmResponse {
  text: string | null;
  toolCalls: LlmToolCall[];
}

export interface LlmProvider {
  readonly name: 'openai' | 'anthropic';
  readonly model: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

export interface ProviderOptions {
  apiKey: string | null;
  baseUrl: string;
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function postJson(opts: ProviderOptions, url: string, headers: Record<string, string>, body: unknown, label: string): Promise<unknown> {
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000),
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 300);
    try {
      const j = JSON.parse(text) as { error?: { message?: string } | string };
      detail = typeof j.error === 'string' ? j.error : (j.error?.message ?? detail);
    } catch {
      // keep raw text
    }
    throw new Error(`${label} API error ${res.status}: ${detail}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${label} API returned invalid JSON`);
  }
}
