import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
export function env(){const sql=new DatabaseSync(':memory:');for(const f of fs.readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('migrations/'+f,'utf8'));
 let queue=Promise.resolve();
 const serialized=operation=>{const result=queue.then(operation);queue=result.catch(()=>{});return result};
 const prep=(query,args=[])=>({bind(...a){return prep(query,a)},first(){return serialized(()=>sql.prepare(query).get(...args)??null)},all(){return serialized(()=>({results:sql.prepare(query).all(...args)}))},_run(){const r=sql.prepare(query).run(...args);return {meta:{changes:r.changes}}},run(){return serialized(()=>this._run())}});
 const store=new Map();return {EXPORTER_EMAIL:'operator@example.com',DB:{prepare:prep,batch(statements){return serialized(()=>{sql.exec('BEGIN');try{const out=statements.map(q=>q._run());sql.exec('COMMIT');return out}catch(e){sql.exec('ROLLBACK');throw e}})}},BUCKET:{async put(k,b,o){store.set(k,{body:b,httpMetadata:o.httpMetadata})},async get(k){return store.get(k)||null},async delete(k){store.delete(k)}}};}
