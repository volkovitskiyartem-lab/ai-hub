import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export class Hub {
 constructor({projects, providers, dataDir}) {
  this.projects = projects; this.providers = providers;
  mkdirSync(dataDir, {recursive:true, mode:0o700});
  this.db = new DatabaseSync(join(dataDir, 'usage.sqlite'));
  this.db.exec(`CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, project TEXT, model TEXT, task_id TEXT, revision INTEGER, status TEXT, input_tokens INTEGER, output_tokens INTEGER, cost REAL, reserved REAL, duration_ms INTEGER, test_result TEXT, created TEXT)`);
 }
 async submit(t) {
  const p = this.projects[t.project];
  if (!p?.enabled || !p.models?.includes(t.model) || !p.categories?.includes(t.category) || !this.providers[t.model]) throw Error('Access denied');
  if (typeof t.prompt !== 'string' || !t.prompt.trim() || t.prompt.length > 20000) throw Error('Invalid prompt');
  if (/(password|api[_ -]?key|authorization|bearer\s+\S+|secret|парол[ьяей]|токен\s*[:=])\s*[:=]|-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(t.prompt)) throw Error('Sensitive data detected');
  const rev = t.revision ?? 0;
  if (!Number.isInteger(rev) || rev < 0 || rev > 2) throw Error('Invalid revision');
  let taskId = t.task_id;
  if (rev === 0) { if (taskId) throw Error('New task cannot specify task_id'); taskId = randomUUID(); }
  else {
   if (typeof taskId !== 'string') throw Error('Revision requires task_id');
   const prior = this.db.prepare('SELECT revision, status FROM requests WHERE task_id=? AND project=? ORDER BY revision DESC LIMIT 1').get(taskId,t.project);
   if (!prior || prior.revision !== rev-1 || prior.status === 'pending') throw Error('Invalid revision sequence');
  }
  const price = p.price_per_million;
  if (!price || !Number.isFinite(price.input) || !Number.isFinite(price.output) || price.input < 0 || price.output < 0) throw Error('Known price required');
  if (!Number.isInteger(t.max_output_tokens) || t.max_output_tokens < 1 || t.max_output_tokens > p.max_output_tokens) throw Error('Invalid output limit');
  // UTF-8 bytes plus conservative framing allowance; a hard provider-side input token cap is unavailable.
  const inputBound = Buffer.byteLength(t.prompt, 'utf8') + 100;
  if (!Number.isInteger(t.max_input_tokens) || inputBound > t.max_input_tokens) throw Error('Input exceeds conservative limit');
  const reserved = (inputBound * price.input + t.max_output_tokens * price.output) / 1e6;
  const id=randomUUID(), start=Date.now();
  this.db.exec('BEGIN IMMEDIATE');
  try {
   const totals=this.db.prepare('SELECT COUNT(*) n, COALESCE(SUM(reserved),0) cost FROM requests WHERE project=?').get(t.project);
   if (!Number.isInteger(p.max_requests) || totals.n >= p.max_requests) throw Error('Request limit reached');
   if (!Number.isFinite(p.max_cost) || totals.cost + reserved > p.max_cost) throw Error('Budget limit reached');
   this.db.prepare('INSERT INTO requests VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,t.project,t.model,taskId,rev,'pending',null,null,null,reserved,null,null,new Date().toISOString());
   this.db.exec('COMMIT');
  } catch(e) { this.db.exec('ROLLBACK'); throw e; }
  try {
   const result=await this.providers[t.model].run({prompt:t.prompt, maxOutputTokens:t.max_output_tokens});
   if (typeof result.text !== 'string') throw Error('Invalid response');
   const i=result.usage?.input, o=result.usage?.output;
   const known=Number.isInteger(i)&&i>=0&&Number.isInteger(o)&&o>=0;
   const cost=known ? (i*price.input+o*price.output)/1e6 : null;
   // Never reduce the reservation: pricing, tokenization and provider-side accounting may differ.
   this.db.prepare('UPDATE requests SET status=?,input_tokens=?,output_tokens=?,cost=?,reserved=?,duration_ms=? WHERE id=?').run('received',known?i:null,known?o:null,cost,Math.max(reserved,cost??0),Date.now()-start,id);
   return {request_id:id, task_id:taskId, revision:rev, text:result.text, usage:known?{input:i,output:o}:null, estimated_cost:cost};
  } catch {
   this.db.prepare('UPDATE requests SET status=?,duration_ms=? WHERE id=?').run('failed',Date.now()-start,id);
   throw Error('Provider request failed; details withheld');
  }
 }
 stats(project) {
  if (!this.projects[project]) throw Error('Unknown project');
  const x=this.db.prepare(`SELECT COUNT(*) requests, COALESCE(SUM(input_tokens),0) input_tokens, COALESCE(SUM(output_tokens),0) output_tokens, SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failures, SUM(CASE WHEN revision>0 THEN 1 ELSE 0 END) revisions, SUM(CASE WHEN status='accepted' THEN 1 ELSE 0 END) accepted, SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) rejected, SUM(CASE WHEN test_result='passed' THEN 1 ELSE 0 END) tests_passed, SUM(CASE WHEN test_result='failed' THEN 1 ELSE 0 END) tests_failed, SUM(CASE WHEN test_result='not_run' THEN 1 ELSE 0 END) tests_not_run, COALESCE(SUM(cost),0) estimated_cost, COALESCE(SUM(reserved),0) budget_reserved, COALESCE(SUM(duration_ms),0) duration_ms, SUM(CASE WHEN status='received' AND input_tokens IS NULL THEN 1 ELSE 0 END) unknown_usage FROM requests WHERE project=?`).get(project);
  return {...x, by_model:this.db.prepare(`SELECT model, COUNT(*) requests, SUM(input_tokens) input_tokens, SUM(output_tokens) output_tokens, SUM(cost) estimated_cost, SUM(duration_ms) duration_ms, SUM(CASE WHEN revision>0 THEN 1 ELSE 0 END) revisions, SUM(CASE WHEN status='accepted' THEN 1 ELSE 0 END) accepted, SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) rejected, SUM(CASE WHEN test_result='passed' THEN 1 ELSE 0 END) tests_passed, SUM(CASE WHEN test_result='failed' THEN 1 ELSE 0 END) tests_failed FROM requests WHERE project=? GROUP BY model`).all(project)};
 }
 review({project,request_id,outcome,test_result}) {
  if (!['accepted','rejected'].includes(outcome) || !['passed','failed','not_run'].includes(test_result)) throw Error('Invalid review');
  const r=this.db.prepare("UPDATE requests SET status=?,test_result=? WHERE id=? AND project=? AND status='received'").run(outcome,test_result,request_id,project);
  if (!r.changes) throw Error('Request not found or already reviewed');
  return {ok:true};
 }
}
