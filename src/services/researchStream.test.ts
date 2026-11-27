import { describe, expect, it } from 'vitest';
import { readResearchStream } from './researchStream';
const meta = { type: 'meta', research_only: true, execution_allowed: false };
const end = { type: 'done', ok: true };
const frame = (x: unknown) => 'data: ' + JSON.stringify(x) + '\n\n';
const response = (body: string) => new Response(body, { headers: { 'content-type': 'text/event-stream' } });
const run = (body: string, assertCurrent = () => {}, maxBytes?: number) => readResearchStream(response(body), () => {}, {
  assertCurrent, allowedTypes: ['meta', 'text', 'error', 'done'], maxBytes,
});
describe('research SSE fail-closed framing', () => {
  it('accepts metadata, text, terminal and EOF', async () => {
    await expect(run(frame(meta) + frame({type:'text',delta:'ok'}) + frame(end))).resolves.toBeUndefined();
  });
  it('accepts an explicit early failure without success', async () => {
    await expect(run(frame({type:'error'}) + frame({type:'done',ok:false}))).resolves.toBeUndefined();
  });
  it.each([
    frame(end), frame(meta), frame(meta)+frame(end)+frame(end),
    frame(meta)+frame(end)+frame({type:'error'}),
    frame(meta)+frame({type:'error'})+frame(end),
    frame(meta)+frame(meta)+frame(end),
    frame(meta)+frame({type:'unknown'})+frame(end),
    frame(meta)+frame(end).trimEnd(), frame(meta)+'data: {bad}\n\n',
    frame({...meta,execution_allowed:true})+frame(end),
  ])('rejects malformed or contradictory stream %#', async (body) => {
    await expect(run(body)).rejects.toThrow();
  });
  it('checks pairing and size limits', async () => {
    await expect(run(frame(meta)+frame(end), () => { throw new Error('changed'); })).rejects.toThrow('changed');
    await expect(run(frame(meta)+frame(end), () => {}, 5)).rejects.toThrow('too large');
  });
  it('rejects stalled stream', async () => {
    const stalled = new Response(new ReadableStream(), {headers:{'content-type':'text/event-stream'}});
    await expect(readResearchStream(stalled,()=>{},{assertCurrent:()=>{},allowedTypes:['meta','done'],idleMs:5})).rejects.toThrow('idle timeout');
  });
});
