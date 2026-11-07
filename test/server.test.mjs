import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
test('MCP stdio initializes, lists tools and denies unregistered project', async () => {
 const dir=mkdtempSync(join(tmpdir(),'hub-mcp-'));
 const child=spawn(process.execPath,[fileURLToPath(new URL('../src/server.mjs',import.meta.url))],{env:{...process.env,AI_HUB_HOME:dir},stdio:['pipe','pipe','pipe']});
 const lines=createInterface({input:child.stdout}); const replies=[];
 const done=(async()=>{for await(const l of lines) replies.push(JSON.parse(l));})();
 for(const m of [
  {jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test',version:'1'}}},
  {jsonrpc:'2.0',id:2,method:'tools/list'},
  {jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'submit_task',arguments:{project:'unknown',model:'gigachat',category:'code',prompt:'hello',max_input_tokens:200,max_output_tokens:20}}}
 ]) child.stdin.write(JSON.stringify(m)+'\n');
 child.stdin.end(); await done;
 assert.equal(replies.length,3); assert.equal(replies[0].result.serverInfo.name,'ai-hub');
 assert.equal(replies[1].result.tools.length,3); assert.equal(replies[2].result.isError,true);
});
