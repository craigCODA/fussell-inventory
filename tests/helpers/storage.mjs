import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
export function env(){const sql=new DatabaseSync(':memory:');for(const f of fs.readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('migrations/'+f,'utf8'));
 const prep=(query,args=[])=>({bind(...a){return prep(query,a)},async first(){return sql.prepare(query).get(...args)??null},async all(){return {results:sql.prepare(query).all(...args)}},async run(){const r=sql.prepare(query).run(...args);return {meta:{changes:r.changes}}}});
 const store=new Map();return {DB:{prepare:prep,async batch(s){sql.exec('BEGIN');try{const out=[];for(const q of s)out.push(await q.run());sql.exec('COMMIT');return out}catch(e){sql.exec('ROLLBACK');throw e}}},BUCKET:{async put(k,b,o){store.set(k,{body:b,httpMetadata:o.httpMetadata})},async get(k){return store.get(k)||null},async delete(k){store.delete(k)}}};}
