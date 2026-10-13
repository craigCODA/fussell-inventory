import test from 'node:test';
import assert from 'node:assert/strict';
import {env} from './helpers/storage.mjs';
import {handleApi} from '../lib/service.mjs';

const user={userId:'operator',email:'operator@example.com'};
const req=(path,body)=>new Request('https://app.test/api/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const call=async(e,path,body)=>{const response=await handleApi(req(path,body),e,user);return {status:response.status,body:await response.json()}};
async function create(e,overrides={}){
 const id=crypto.randomUUID();const result=await call(e,'records',{id,inventoryId:'TMP-'+id.replaceAll('-',''),status:'draft',type:'Dryer',storeCode:'BA',fuel:'Electric',receivingStore:'BA',receivedDate:'2026-10-12',...overrides});
 assert.equal(result.status,200,JSON.stringify(result.body));return result.body;
}
const number=async(e,r)=>{const result=await call(e,'exports',{requestId:r.id,kind:'inventory',items:[{id:r.id,revision:r.revision}]});return {...result,body:result.status===200?result.body.records[0]:result.body}};

test('assign the sequence at export, with one dash and independent type/store/day counters',async()=>{
 const e=env();
 for(const [overrides,expected] of [
  [{},'FA-DEBA20261012001'],[{},'FA-DEBA20261012002'],
  [{receivingStore:'AL'},'FA-DEAL20261012001'],[{fuel:'Gas'},'FA-DGBA20261012001'],
  [{receivedDate:'2026-10-13'},'FA-DEBA20261013001'],[{type:'Dishwasher',fuel:''},'FA-DWBA20261012001']
 ]){
  const r=await create(e,overrides);assert.match(r.inventoryId,/^TMP-/);assert.equal(r.numberAssignedAt,undefined);
  const result=await number(e,r);assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.inventoryId,expected);assert.ok(result.body.numberAssignedAt);assert.ok(result.body.exportedAt);
 }
});
test('retry after a lost numbering response returns the same number without consuming another',async()=>{
 const e=env(),r=await create(e),a=await number(e,r),b=await number(e,r);
 assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(a.body.inventoryId,b.body.inventoryId);assert.equal(a.body.revision,b.body.revision);
 assert.equal((await number(e,await create(e))).body.inventoryId,'FA-DEBA20261012002');
});
test('concurrent phones receive different numbers and concurrent retry of one item is idempotent',async()=>{
 const e=env(),records=[];for(let i=0;i<12;i++)records.push(await create(e));
 const results=await Promise.all(records.flatMap(r=>[number(e,r),number(e,r)]));
 assert.ok(results.every(r=>r.status===200),JSON.stringify(results));
 assert.equal(new Set(results.map(r=>r.body.inventoryId)).size,12);
 assert.equal((await number(e,await create(e))).body.inventoryId,'FA-DEBA20261012013');
});
test('numbering rejects missing store/fuel, invalid dates, and stale revisions without consuming a number',async()=>{
 const e=env();
 for(const overrides of [{storeCode:'',receivingStore:'',location:''},{fuel:''},{type:'',fuel:''}])assert.equal((await number(e,await create(e,overrides))).status,400);
 const invalid=await call(e,'records',{id:crypto.randomUUID(),inventoryId:'TMP-INVALID',status:'draft',receivedDate:'2026-02-30'});assert.equal(invalid.status,400);
 const r=await create(e);await call(e,'records',{...r,notes:'changed'});assert.equal((await number(e,r)).status,409);
 assert.equal((await number(e,await create(e))).body.inventoryId,'FA-DEBA20261012001');
});
test('assigned identifiers and receiving metadata stay fixed through edits and store transfers',async()=>{
 const e=env(),r=(await number(e,await create(e))).body;
 assert.equal((await call(e,'records',{...r,inventoryId:'FA-DEAL20261012009'})).status,409);
 const changed=await call(e,'records',{...r,location:'Alexandria · Fussell Appliances',receivingStore:'AL',receivedDate:'2026-10-13'});assert.equal(changed.status,409);
 const transferred=await call(e,'records',{...r,location:'Alexandria · Fussell Appliances'});assert.equal(transferred.status,200);assert.equal(transferred.body.inventoryId,r.inventoryId);assert.equal(transferred.body.receivingStore,'BA');
 assert.equal((await call(e,'records/delete',{id:r.id,revision:transferred.body.revision,target:'app'})).status,409);
});
test('older clients preserve assigned metadata and cannot create or forge final numbers',async()=>{
 const e=env(),r=(await number(e,await create(e))).body;
 const old={...r,notes:'old client edit'};delete old.numberAssignedAt;delete old.numberType;delete old.receivingStore;delete old.receivedDate;delete old.fuel;
 const result=await call(e,'records',old);assert.equal(result.status,200);assert.equal(result.body.numberAssignedAt,r.numberAssignedAt);assert.equal(result.body.receivingStore,'BA');assert.equal(result.body.fuel,'Electric');
 for(const overrides of [{inventoryId:'FA-DEBA20261012099'},{numberAssignedAt:'2026-10-13T00:00:00.000Z'}]){
  const id=crypto.randomUUID();assert.notEqual((await call(e,'records',{id,inventoryId:'TMP-'+id.replaceAll('-',''),status:'draft',...overrides})).status,200);
 }
});
test('already exported legacy records retain their IDs and do not consume numbers',async()=>{
 const e=env(),legacy=await create(e,{inventoryId:'FA-OLD'});
 await e.DB.prepare("UPDATE appliances SET payload=json_set(payload,'$.exportedAt',?,'$.exportKinds',json(?)) WHERE id=?").bind('2026-10-12T10:00:00.000Z','["inventory"]',legacy.id).run();
 const result=await number(e,legacy);assert.equal(result.status,200);assert.equal(result.body.inventoryId,'FA-OLD');assert.equal(result.body.numberAssignedAt,undefined);
 assert.equal((await number(e,await create(e))).body.inventoryId,'FA-DEBA20261012001');
});
test('counter rollback is atomic and numbering keys never leak into prompt recordings',async()=>{
 const e=env(),r=await create(e),batch=e.DB.batch;
 e.DB.batch=statements=>batch([...statements,e.DB.prepare('INSERT INTO missing_table VALUES (1)')]);
 assert.equal((await number(e,r)).status,400);e.DB.batch=batch;
 assert.equal((await number(e,r)).body.inventoryId,'FA-DEBA20261012001');
 const response=await handleApi(new Request('https://app.test/api/prompts'),e,user);assert.deepEqual(await response.json(),{});
});
test('sequence expands beyond 999 and skips existing legacy numbers of the same prefix',async()=>{
 const e=env();await e.DB.prepare('INSERT INTO settings(key,value) VALUES (?,?)').bind('inventory-counter:FA-DEBA20261012','999').run();
 assert.equal((await number(e,await create(e))).body.inventoryId,'FA-DEBA202610121000');
 const legacy=await create(e,{inventoryId:'FA-MANUAL'});
 await e.DB.prepare("UPDATE appliances SET inventory_id=?,payload=json_set(payload,'$.inventoryId',?,'$.exportedAt',?) WHERE id=?").bind('FA-DEBA202610121005','FA-DEBA202610121005','2026-10-12T12:00:00.000Z',legacy.id).run();
 assert.equal((await number(e,await create(e))).body.inventoryId,'FA-DEBA202610121006');
});
