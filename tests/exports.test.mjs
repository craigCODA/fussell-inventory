import test from 'node:test';import assert from 'node:assert/strict';
import {env} from './helpers/storage.mjs';import {handleApi} from '../lib/service.mjs';
import {localDate,mergeWorkflow,typeCode} from '../lib/numbering.mjs';
const owner={userId:'exporter',email:'operator@example.com'},staff={userId:'receiver',email:'staff@example.com'};
async function call(e,path,body,user=owner){const r=await handleApi(new Request('https://app.test/api/'+path,{method:body?'POST':'GET',...body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}}),e,user);return {status:r.status,body:await r.json()}}
async function create(e,extra={}){const id=crypto.randomUUID(),r=await call(e,'records',{id,inventoryId:'TMP-'+id.replaceAll('-',''),type:'Dishwasher',status:'draft',storeCode:'BA',receivingStore:'BA',receivedDate:'2026-10-12',...extra});assert.equal(r.status,200,JSON.stringify(r.body));return r.body}
const payload=records=>({requestId:crypto.randomUUID(),kind:'inventory',items:records.map(r=>({id:r.id,revision:r.revision}))});
const countEvents=async e=>(await e.DB.prepare("SELECT key FROM settings WHERE key LIKE 'inventory-export:%'").all()).results.length;
test('only the designated verified account can export, number, view history, or reverse',async()=>{
 const e=env(),r=await create(e),input=payload([r]);
 for(const path of ['exports','exports/reverse'])assert.equal((await call(e,path,input,staff)).status,403);
 assert.equal((await call(e,'exports',undefined,staff)).status,403);
 assert.equal((await call(e,'export?kind=inventory&ids='+r.id,undefined,staff)).status,403);
 assert.equal((await call(e,'records',{...r,exportedAt:'2026-10-12T10:00:00.000Z',exportKinds:['inventory']},staff)).status,403);
 assert.equal(await countEvents(e),0);
 assert.equal((await call(e,'session',undefined,staff)).body.canExport,false);
 assert.equal((await call(e,'session')).body.canExport,true);
 delete e.EXPORTER_EMAIL;assert.equal((await call(e,'exports',input)).status,403);
});
test('mixed stores block before allocation; explicit override records the reason and both stores',async()=>{
 const e=env(),a=await create(e),b=await create(e,{storeCode:'AL',receivingStore:'AL'}),input=payload([a,b]);
 const rejected=await call(e,'exports',input);assert.equal(rejected.status,409);assert.equal(rejected.body.code,'mixed_stores');assert.equal(rejected.body.stores.length,2);assert.equal(await countEvents(e),0);
 assert.equal((await e.DB.prepare("SELECT * FROM settings WHERE key LIKE 'inventory-counter:%'").all()).results.length,0);
 const result=await call(e,'exports',{...input,overrideReason:'Combined pickup reviewed'});assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.event.overrideReason,'Combined pickup reviewed');assert.equal(result.body.event.by,owner.email);
 assert.deepEqual(result.body.records.map(r=>r.inventoryId).sort(),['FA-DWAL20261012001','FA-DWBA20261012001']);
});
test('mixed-store check uses current location while ID uses original receiving store',async()=>{
 const e=env(),a=await create(e,{storeCode:'AL',receivingStore:'BA'}),b=await create(e,{storeCode:'AL',receivingStore:'AL'});
 const result=await call(e,'exports',payload([a,b]));assert.equal(result.status,200);assert.equal(result.body.event.stores.length,1);assert.equal(result.body.event.stores[0].code,'AL');assert.equal(result.body.records.find(r=>r.id===a.id).inventoryId,'FA-DWBA20261012001');
});
test('a partial reversal syncs state, preserves IDs/status/location, blocks deletion, and is idempotent',async()=>{
 const e=env(),a=await create(e,{status:'reserved',location:'Ball'}),b=await create(e),first=await call(e,'exports',payload([a,b]));assert.equal(first.status,200);
 const before=first.body.records.find(r=>r.id===a.id),other=first.body.records.find(r=>r.id===b.id);
 const input={requestId:crypto.randomUUID(),batchId:first.body.event.id,items:[{id:before.id,revision:before.revision}],reason:'Wrong item selected'};
 const result=await call(e,'exports/reverse',input);assert.equal(result.status,200,JSON.stringify(result.body));const after=result.body.records[0];
 assert.equal(after.inventoryId,before.inventoryId);assert.equal(after.exportedAt,undefined);assert.equal(after.exportBatchId,undefined);assert.equal(after.status,'reserved');assert.equal(after.location,'Ball');assert.equal(after.exportReversal.reason,input.reason);
 assert.equal((await call(e,'exports/reverse',input)).body.records[0].revision,after.revision);
 assert.equal((await call(e,'records/delete',{id:after.id,revision:after.revision,target:'app'})).status,409);
 const listed=(await call(e,'records')).body.records;assert.ok(listed.find(r=>r.id===b.id).exportedAt);
 const history=(await call(e,'exports')).body.events;assert.equal(history.length,2);assert.deepEqual(history.find(x=>x.kind==='export').reversedIds,[a.id]);
 const reexport=await call(e,'exports',payload([after]));assert.equal(reexport.status,200);assert.equal(reexport.body.records[0].inventoryId,before.inventoryId);
 assert.equal((await call(e,'exports',payload([await create(e)]))).body.records[0].inventoryId,'FA-DWBA20261012003');
 assert.equal((await call(e,'exports/reverse',{...input,requestId:crypto.randomUUID(),items:[{id:other.id,revision:other.revision}],reason:'Second correction'})).status,200);
 assert.deepEqual((await call(e,'exports/'+first.body.event.id)).body.event.reversedIds.sort(),[a.id,b.id].sort());
});
test('an old offline edit cannot restore a reversed export even if it submits processing fields',async()=>{
 const e=env(),original=(await call(e,'exports',payload([await create(e)]))).body.records[0];
 const reversed=(await call(e,'exports/reverse',{requestId:crypto.randomUUID(),items:[{id:original.id,revision:original.revision}],reason:'Incorrect export'})).body.records[0];
 const offline=await call(e,'records',{...original,notes:'offline edit'});assert.equal(offline.status,200);assert.equal(offline.body.exportedAt,undefined);assert.equal(offline.body.notes,'offline edit');
 const saved=await call(e,'records',{...original,revision:offline.body.revision,notes:'reviewed edit'});assert.equal(saved.status,200);assert.equal(saved.body.exportedAt,undefined);assert.equal(saved.body.exportReversal.id,reversed.exportReversal.id);
 const merged=mergeWorkflow({...original,notes:'local pending edit'},reversed);assert.equal(merged.exportedAt,undefined);assert.equal(merged.notes,'local pending edit');assert.equal(merged.inventoryId,original.inventoryId);
 assert.equal(mergeWorkflow(reversed,original).exportedAt,undefined);
});
test('all-or-nothing guard prevents partial export or reversal when one record changed',async()=>{
 const e=env(),a=await create(e),b=await create(e),input=payload([a,b]);await call(e,'records',{...b,notes:'changed'});
 assert.equal((await call(e,'exports',input)).status,409);assert.equal(await countEvents(e),0);assert.match((await call(e,'records')).body.records.find(r=>r.id===a.id).inventoryId,/^TMP-/);
 const batch=await call(e,'exports',payload((await call(e,'records')).body.records));const records=batch.body.records;
 await call(e,'records',{...records[1],notes:'another edit'});
 assert.equal((await call(e,'exports/reverse',{...payload(records),reason:'Mistake'})).status,409);
 assert.ok((await call(e,'records')).body.records.every(r=>r.exportedAt));
});
test('simultaneous overlapping exports cannot double-assign or partly process a batch',async()=>{
 const e=env(),a=await create(e),b=await create(e),c=await create(e);
 const results=await Promise.all([call(e,'exports',payload([a,b])),call(e,'exports',payload([b,c]))]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(await countEvents(e),1);
 const records=(await call(e,'records')).body.records;assert.equal(records.filter(r=>r.exportedAt).length,2);assert.equal(new Set(records.filter(r=>r.exportedAt).map(r=>r.inventoryId)).size,2);
});
test('legacy processed items can reverse without renumbering, and newer exports protect against old batch reversal',async()=>{
 const e=env(),r=await create(e,{inventoryId:'FA-LEGACY'});await e.DB.prepare("UPDATE appliances SET payload=json_set(payload,'$.exportedAt',?,'$.exportKinds',json(?)) WHERE id=?").bind('2026-10-12T00:00:00.000Z','["inventory"]',r.id).run();
 const result=await call(e,'exports/reverse',{requestId:crypto.randomUUID(),items:[{id:r.id,revision:r.revision}],reason:'Legacy export mistake'});assert.equal(result.status,200);assert.equal(result.body.records[0].inventoryId,'FA-LEGACY');assert.equal(result.body.records[0].processedOnce,true);
 const first=(await call(e,'exports',payload(result.body.records))).body,second=(await call(e,'exports',payload(first.records))).body;
 assert.equal((await call(e,'exports/reverse',{requestId:crypto.randomUUID(),batchId:first.event.id,items:second.records.map(r=>({id:r.id,revision:r.revision})),reason:'Old batch'})).status,409);
});
test('Louisiana dates and all appliance codes are deterministic',()=>{
 assert.equal(localDate('2026-10-13T03:30:00.000Z'),'2026-10-12');assert.equal(localDate('2026-01-02T05:30:00.000Z'),'2026-01-01');
 for(const [type,fuel,code] of [['Washer','','WM'],['Dryer','Electric','DE'],['Dryer','Gas','DG'],['Oven','Electric','OE'],['Oven','Gas','OG'],['Range','Electric','RE'],['Range','Gas','RG'],['Refrigerator','','RF'],['Freezer','','DF'],['Microwave','','MW'],['Other','','OT']])assert.equal(typeCode({type,fuel}),code);
});
test('large Unicode snapshots fail before changes rather than exceeding D1 row limits',async()=>{
 const e=env(),records=[];for(let i=0;i<80;i++)records.push(await create(e,{notes:'💧'.repeat(6000)}));
 const result=await call(e,'exports',payload(records));assert.equal(result.status,400);assert.match(result.body.error,/smaller groups/);assert.equal(await countEvents(e),0);assert.ok((await call(e,'records')).body.records.every(r=>r.inventoryId.startsWith('TMP-')));
});
