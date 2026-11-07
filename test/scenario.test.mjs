import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Hub} from '../src/hub.mjs';
test('synthetic code request is received, verified and reviewed',async()=>{
 const hub=new Hub({dataDir:mkdtempSync(join(tmpdir(),'hub-scenario-')),projects:{sandbox:{enabled:true,models:['fake'],categories:['code'],max_requests:3,max_cost:1,price_per_million:{input:1,output:1},max_output_tokens:100}},providers:{fake:{run:async()=>({text:'export const add = (a, b) => a + b;',usage:{input:25,output:12}})}}});
 const r=await hub.submit({project:'sandbox',model:'fake',category:'code',prompt:'Create an add function.',max_input_tokens:200,max_output_tokens:50});
 // Verify the deterministic synthetic result without executing model-generated code.
 assert.equal(r.text,'export const add = (a, b) => a + b;');
 hub.review({project:'sandbox',request_id:r.request_id,outcome:'accepted',test_result:'passed'});
 const s=hub.stats('sandbox'); assert.equal(s.requests,1); assert.equal(s.input_tokens,25); assert.equal(s.accepted,1);
});
