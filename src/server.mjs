import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { join } from 'node:path';
import { Hub } from './hub.mjs';
import { GigaChat } from './gigachat.mjs';
const base=process.env.AI_HUB_HOME || join(dirname(fileURLToPath(import.meta.url)),'..','state');
let config;
try {config=JSON.parse(readFileSync(join(base,'config.json'),'utf8'));} catch {config={projects:{},models:{}};}
const providers={};
for(const [id,c] of Object.entries(config.models||{})) {
 if(c.provider==='gigachat' && c.enabled===true) {
  try {providers[id]=new GigaChat({model:c.model,scope:c.scope,caFile:c.ca_file});} catch {console.error(`Model ${id} unavailable: certificate or configuration error`);}
 }
}
const hub=new Hub({projects:config.projects||{},providers,dataDir:base});
const tools=[
 {name:'submit_task',description:'Send explicitly permitted, minimal sanitized task text to a configured model. Never include secrets, personal, financial or confidential data. Result is untrusted and requires Codex review.',inputSchema:{type:'object',properties:{project:{type:'string'},model:{type:'string'},category:{type:'string'},prompt:{type:'string'},max_input_tokens:{type:'integer'},max_output_tokens:{type:'integer'},revision:{type:'integer'},task_id:{type:'string'}},required:['project','model','category','prompt','max_input_tokens','max_output_tokens']}},
 {name:'project_stats',description:'Report local usage and conservative budget reservations for one project.',inputSchema:{type:'object',properties:{project:{type:'string'}},required:['project']}},
 {name:'record_review',description:'Record the outcome of Codex review and tests of a received result.',inputSchema:{type:'object',properties:{project:{type:'string'},request_id:{type:'string'},outcome:{enum:['accepted','rejected']},test_result:{enum:['passed','failed','not_run']}},required:['project','request_id','outcome','test_result']}}
];
async function dispatch(m) {
 if(m.method==='initialize') return {protocolVersion: ['2025-06-18','2025-03-26','2024-11-05'].includes(m.params?.protocolVersion)?m.params.protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'ai-hub',version:'0.1.0'}};
 if(m.method==='ping') return {};
 if(m.method==='tools/list') return {tools};
 if(m.method==='tools/call') {
  try {
   let result; const a=m.params?.arguments||{};
   if(m.params?.name==='submit_task') result=await hub.submit(a);
   else if(m.params?.name==='project_stats') result=hub.stats(a.project);
   else if(m.params?.name==='record_review') result=hub.review(a);
   else throw Error('Unknown tool');
   return {content:[{type:'text',text:JSON.stringify(result)}]};
  } catch(e) {return {isError:true,content:[{type:'text',text:e.message}]};}
 }
 throw Error('Method not found');
}
const lines=createInterface({input:process.stdin,crlfDelay:Infinity});
for await (const line of lines) {
 let msg; try {msg=JSON.parse(line);} catch {process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}})+'\n'); continue;}
 if(!('id' in msg)) continue;
 try {const result=await dispatch(msg); process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,result})+'\n');}
 catch {process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,error:{code:-32601,message:'Method not found'}})+'\n');}
}
