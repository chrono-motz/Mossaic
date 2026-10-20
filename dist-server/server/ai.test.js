import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileMissionDraft, executeStudioLlmTurn } from './ai';
const originalApiKey = process.env.AI_API_KEY;
const originalEnabled = process.env.AI_ENABLED;
afterEach(() => {
    if (originalApiKey === undefined)
        delete process.env.AI_API_KEY;
    else
        process.env.AI_API_KEY = originalApiKey;
    if (originalEnabled === undefined)
        delete process.env.AI_ENABLED;
    else
        process.env.AI_ENABLED = originalEnabled;
    vi.unstubAllGlobals();
});
describe('server AI planner boundary', () => {
    it('uses an OpenAI-compatible structured response without exposing the key to the browser', async () => {
        process.env.AI_API_KEY = 'server-only-test-key';
        process.env.AI_ENABLED = 'true';
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                choices: [{ message: { content: JSON.stringify({
                                title: 'Cooling station',
                                budget: 6000,
                                reserve: 500,
                                deadline: '2026-10-20T19:30:00',
                                beneficiaries: 120,
                                constraints: ['Prefer reusable supplies'],
                                confidence: 0.97,
                            }) } }],
            }),
        });
        vi.stubGlobal('fetch', fetchMock);
        const result = await compileMissionDraft('Create a cooling station for 120 people by 7:30 PM with a $6,000 budget.');
        expect(result.provider).toBe('ai');
        expect(result.draft.budget).toBe(6000);
        expect(result.draft.beneficiaries).toBe(120);
        expect(fetchMock).toHaveBeenCalledWith('https://api.openai.com/v1/chat/completions', expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({ authorization: 'Bearer server-only-test-key' }),
        }));
    });
    it('keeps the deterministic planner as the explicit no-credential fallback', async () => {
        delete process.env.AI_API_KEY;
        process.env.AI_ENABLED = 'true';
        const result = await compileMissionDraft('Create a heat-relief station for 80 people by 6 PM with a $4,500 budget.');
        expect(result.provider).toBe('demo');
        expect(result.draft.budget).toBe(4500);
    });
    it('provides an AG Studio Agent Framework response in demo mode', async () => {
        delete process.env.AI_API_KEY;
        process.env.AI_ENABLED = 'false';
        const result = await executeStudioLlmTurn({
            input: [],
            responseFormat: { type: 'text' },
            tools: [],
        });
        expect(result.status).toBe('completed');
        expect(result.output[0]).toMatchObject({ type: 'message', role: 'assistant' });
    });
});
//# sourceMappingURL=ai.test.js.map