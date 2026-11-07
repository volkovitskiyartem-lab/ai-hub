import https from 'node:https';
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { rootCertificates } from 'node:tls';
const exec = promisify(execFile);
function request(url, {method='GET', headers={}, body, ca, timeout=20000}) {
 return new Promise((resolve,reject)=>{
  const req=https.request(url,{method,headers,ca,timeout},res=>{
   let chunks='', length=0;
   res.setEncoding('utf8'); res.on('data', c=>{length+=Buffer.byteLength(c); if(length>2_000_000) req.destroy(Error('Response too large')); else chunks+=c;});
   res.on('end',()=>{ if(res.statusCode<200||res.statusCode>=300) return reject(Error(`HTTP ${res.statusCode}`)); try {resolve(JSON.parse(chunks));} catch {reject(Error('Invalid response'));} });
  });
  const deadline=setTimeout(()=>req.destroy(Error('Timeout')),timeout); req.on('close',()=>clearTimeout(deadline)); req.on('timeout',()=>req.destroy(Error('Timeout'))); req.on('error',reject); if(body) req.write(body); req.end();
 });
}
export class GigaChat {
 constructor({model, scope, caFile}) {
  if (!['GIGACHAT_API_PERS','GIGACHAT_API_B2B','GIGACHAT_API_CORP'].includes(scope)) throw Error('Invalid scope');
  this.model=model; this.scope=scope;
  this.ca=[...rootCertificates,readFileSync(caFile,'utf8')];
 }
 async token() {
  if (this.accessToken && Date.now() < this.expiresAt-60000) return this.accessToken;
  const {stdout} = await exec('/usr/bin/security',['find-generic-password','-s','codex-ai-hub-gigachat','-a','gigachat-api','-w'],{timeout:10000,maxBuffer:8192});
  const key=stdout.trim(); if (!key) throw Error('Keychain entry is empty');
  const body=new URLSearchParams({scope:this.scope}).toString();
  const token=await request('https://ngw.devices.sberbank.ru:9443/api/v2/oauth',{method:'POST',ca:this.ca,headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json','RqUID':randomUUID(),'Authorization':`Basic ${key}`},body});
  if(typeof token.access_token!=='string' || !Number.isFinite(token.expires_at)) throw Error('Invalid OAuth response');
  this.accessToken=token.access_token; this.expiresAt=token.expires_at; return this.accessToken;
 }
 async run({prompt,maxOutputTokens}) {
  const token=await this.token();
  const body=JSON.stringify({model:this.model,messages:[{role:'user',content:prompt}],max_tokens:maxOutputTokens,stream:false});
  const response=await request('https://api.giga.chat/v1/chat/completions',{method:'POST',ca:this.ca,timeout:60000,headers:{'Content-Type':'application/json','Accept':'application/json','Authorization':`Bearer ${token}`},body});
  return {text:response.choices?.[0]?.message?.content,usage:{input:response.usage?.prompt_tokens,output:response.usage?.completion_tokens}};
 }
}
