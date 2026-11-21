import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Principal } from '../src/platform/principal.ts';
import type { Services } from '../src/services.ts';
import { createTestServices, principal } from './helpers.ts';

describe('offline rules engine', () => {
  let s: Services;
  let maria: Principal;
  beforeAll(async () => {
    s = await createTestServices();
    maria = await principal(s, 'maria');
  });
  afterAll(() => s?.close());

  it('qualifies new leads through the "Qualify new leads with AI" automation', async () => {
    const lead = await s.records.create(maria, 'lead', {
      first_name: 'Vera',
      last_name: 'Quinn',
      company: 'Northwind Global',
      title: 'VP of Operations',
      email: 'vera@northwind-global.com',
      lead_source: 'Referral',
      employees: 5000,
    });
    await s.jobs.drain();
    const scored = await s.records.get(maria, 'lead', lead.id);
    expect(scored.fields.lead_score).toEqual(expect.any(Number));
    expect(['Hot', 'Warm', 'Cold']).toContain(scored.fields.rating);
    const [run] = await s.agents.listRuns(maria, { recordId: lead.id });
    expect(run).toMatchObject({ agentId: 'agt_lead_qualifier', trigger: 'automation', status: 'completed', provider: 'offline' });
    expect(run!.output).toContain(`${scored.fields.lead_score}/100`);
  });

  it('answers chat questions with real data and keeps the conversation', async () => {
    const { runId, conversationId } = await s.agents.startChat(maria, { agentId: 'agt_copilot', message: 'Show my open opportunities' });
    await s.jobs.drain();
    const run = await s.agents.getRun(maria, runId);
    expect(run.status).toBe('completed');
    expect(run.steps.find((st) => st.type === 'tool_call')).toMatchObject({ tool: 'query_records', status: 'ok' });
    expect(run.output).toMatch(/Found \*\*\d+\*\* opportunit/);
    const conv = await s.agents.getConversation(maria, conversationId);
    expect(conv.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    // Conversations are private to their user.
    await expect(s.agents.getConversation(await principal(s, 'james'), conversationId)).rejects.toMatchObject({ status: 404 });
  });
});

describe('LLM provider (mocked OpenAI-compatible API)', () => {
  type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
  let script: { content: string | null; tool_calls?: ToolCall[] }[] = [];
  let requests: { url: string; headers: Headers; body: { model: string; messages: { role: string; content: string | null }[]; tools?: { function: { name: string } }[] } }[] = [];
  let failWith: number | null = null;
  const fakeFetch: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    if (failWith) return new Response(JSON.stringify({ error: { message: 'Rate limit reached' } }), { status: failWith });
    const message = script.shift() ?? { content: 'Done.' };
    return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const call = (name: string, args: unknown): ToolCall => ({ id: `call_${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });

  let s: Services;
  let maria: Principal;
  beforeAll(async () => {
    s = await createTestServices({ fetchImpl: fakeFetch, env: { OPENAI_API_KEY: 'sk-test' } });
    maria = await principal(s, 'maria');
  });
  afterAll(() => s?.close());
  beforeEach(() => {
    script = [];
    requests = [];
    failWith = null;
  });

  async function chat(who: Principal, agentId: string, message: string, recordId?: string) {
    const { runId } = await s.agents.startChat(who, { agentId, message, recordId });
    await s.jobs.drain();
    return s.agents.getRun(who, runId);
  }

  it('queues writes from approval-required agents until a person approves them', async () => {
    const opp = (await s.records.query(maria, 'opportunity', { filters: { match: 'all', rules: [{ field: 'stage', op: 'eq', value: 'Proposal' }] }, pageSize: 1 })).records[0]!;
    script = [{ content: null, tool_calls: [call('update_record', { id: opp.id, fields: { stage: 'Negotiation' } })] }, { content: 'The stage change is awaiting your approval.' }];

    const run = await chat(maria, 'agt_deal_coach', 'Move this deal to negotiation', opp.id);
    expect(run).toMatchObject({ status: 'completed', output: 'The stage change is awaiting your approval.', provider: 'openai', model: 'gpt-4.1-mini' });
    const step = run.steps.find((st) => st.tool === 'update_record')!;
    expect(step.status).toBe('pending_approval');

    const [first, second] = requests;
    expect(first!.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(first!.headers.get('authorization')).toBe('Bearer sk-test');
    expect(first!.body.messages[0]!.content).toContain('queued for a human to approve');
    expect(first!.body.messages[0]!.content).toContain(opp.id);
    const offered = first!.body.tools!.map((t) => t.function.name);
    expect(offered).toContain('update_record');
    expect(offered).not.toContain('delete_record');
    expect(second!.body.messages.at(-1)).toMatchObject({ role: 'tool' });
    expect(second!.body.messages.at(-1)!.content).toContain('pending_approval');

    expect((await s.records.get(maria, 'opportunity', opp.id)).fields.stage).toBe('Proposal');
    await expect(s.agents.decideAction(await principal(s, 'james'), step.actionId!, 'approve')).rejects.toMatchObject({ status: 404 });
    expect((await s.agents.decideAction(maria, step.actionId!, 'approve')).status).toBe('executed');
    expect((await s.records.get(maria, 'opportunity', opp.id)).fields).toMatchObject({ stage: 'Negotiation', probability: 80 });
    expect((await s.agents.getRun(maria, run.id)).steps.find((st) => st.tool === 'update_record')!.status).toBe('ok');
    await expect(s.agents.decideAction(maria, step.actionId!, 'approve')).rejects.toMatchObject({ status: 409 });
  });

  it("limits agents to their enabled tools and the requesting user's permissions", async () => {
    const noah = await principal(s, 'noah');
    const opp = (await s.records.query(maria, 'opportunity', { pageSize: 1 })).records[0]!;

    script = [{ content: null, tool_calls: [call('get_record', { id: opp.id })] }, { content: 'I cannot see that.' }];
    const denied = await chat(noah, 'agt_copilot', `Show me ${opp.id}`);
    expect(denied.steps.find((st) => st.tool === 'get_record')).toMatchObject({ status: 'error' });
    expect(JSON.stringify(denied.steps)).not.toContain(opp.name);

    script = [{ content: null, tool_calls: [call('update_record', { id: opp.id, fields: { stage: 'Closed Lost' } })] }, { content: 'I am read-only.' }];
    const readOnly = await chat(maria, 'agt_hr_assistant', 'Close that deal');
    expect(readOnly.steps.find((st) => st.tool === 'update_record')).toMatchObject({ status: 'error', result: { error: expect.stringContaining('not enabled') } });
    expect(requests.at(-1)!.body.tools!.map((t) => t.function.name)).not.toContain('update_record');
    expect((await s.records.get(maria, 'opportunity', opp.id)).fields.stage).toBe(opp.fields.stage);
  });

  it('marks the run failed with the provider error', async () => {
    failWith = 429;
    const run = await chat(maria, 'agt_copilot', 'Hello');
    expect(run.status).toBe('failed');
    expect(run.error).toBe('OpenAI API error 429: Rate limit reached');
  });
});
