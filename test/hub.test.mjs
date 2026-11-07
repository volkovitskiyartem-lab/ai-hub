import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hub } from '../src/hub.mjs';

const policy = { enabled: true, models: ['mock'], categories: ['code'], max_requests: 2, max_cost: 1, price_per_million: { input: 1, output: 1 }, max_output_tokens: 100 };
function setup(provider = { run: async () => ({ text: 'answer', usage: { input: 10, output: 5 } }) }) {
  return new Hub({ projects: { demo: policy }, providers: { mock: provider }, dataDir: mkdtempSync(join(tmpdir(), 'hub-test-')) });
}
const task = { project: 'demo', model: 'mock', category: 'code', prompt: 'Write a small function', max_input_tokens: 200, max_output_tokens: 50 };
test('unknown projects and sensitive input are denied before provider access', async () => {
 let calls = 0; const hub = setup({run: async () => { calls++; }});
 await assert.rejects(hub.submit({...task, project: 'unknown'}));
 await assert.rejects(hub.submit({...task, prompt: 'password = example123'}));
 assert.equal(calls, 0);
});
test('records usage and enforces request limit', async () => {
 const hub = setup(); await hub.submit(task); await hub.submit(task);
 await assert.rejects(hub.submit(task), /limit/i);
 const s = hub.stats('demo'); assert.equal(s.requests, 2); assert.equal(s.input_tokens, 20); assert.equal(s.output_tokens, 10);
});
test('requires a known tariff and disallows more than two revisions', async () => {
 const hub = setup();
 await assert.rejects(hub.submit({...task, revision: 3}), /revision/i);
 hub.projects.demo = {...policy, price_per_million: null};
 await assert.rejects(hub.submit(task), /price/i);
});
test('provider failures are recorded without leaking error content', async () => {
 const hub = setup({run: async () => { throw new Error('secret content'); }});
 await assert.rejects(hub.submit(task), /provider/i);
 assert.equal(hub.stats('demo').failures, 1);
});
test('records reviews and enforces sequential revisions', async () => {
 const hub=setup(); const one=await hub.submit(task);
 hub.review({project:'demo',request_id:one.request_id,outcome:'rejected',test_result:'failed'});
 await assert.rejects(hub.submit({...task,task_id:one.task_id,revision:2}),/sequence/i);
 const two=await hub.submit({...task,task_id:one.task_id,revision:1});
 hub.review({project:'demo',request_id:two.request_id,outcome:'accepted',test_result:'passed'});
 const stats=hub.stats('demo'); assert.equal(stats.revisions,1); assert.equal(stats.accepted,1); assert.equal(stats.rejected,1);
});
test('unknown provider usage keeps budget reserved', async () => {
 const hub=setup({run:async()=>({text:'ok'})}); const r=await hub.submit(task);
 assert.equal(r.usage,null); assert.ok(hub.stats('demo').budget_reserved>0); assert.equal(hub.stats('demo').unknown_usage,1);
});
test('budget is enforced before a provider call', async () => {
 let calls=0; const hub=setup({run:async()=>{calls++; return {text:'ok'};}});
 hub.projects.demo={...policy,max_cost:0};
 await assert.rejects(hub.submit(task),/budget/i); assert.equal(calls,0);
});
