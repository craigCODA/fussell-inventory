import test from 'node:test';
import assert from 'node:assert/strict';
import {handleApi} from '../lib/service.mjs';
import {env} from './helpers/storage.mjs';

const user={userId:'operator-1',email:'operator@example.com'};
const request=(path,body)=>new Request('https://app.test/api/'+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);
async function save(e,r){const response=await handleApi(request('records',r),e,user);assert.equal(response.status,200);return response.json()}
const record=()=>({id:crypto.randomUUID(),inventoryId:'FA-DELETE',status:'draft'});
async function photo(e){const form=new FormData();form.set('kind','photo');form.set('file',new Blob([new Uint8Array([255,216,255,224])],{type:'image/jpeg'}),'photo.jpg');const response=await handleApi(new Request('https://app.test/api/upload',{method:'POST',body:form}),e,user);assert.equal(response.status,200);return (await response.json()).key}

test('delete removes the record and its unshared photos, retains shared photos and audit',async t=>{
 const outbound=t.mock.method(globalThis,'fetch',async()=>{throw Error('App deletion must not contact KORONA or another external service')});
 const e=env(),frontKey=await photo(e),tagKey=await photo(e);
 const r=await save(e,{...record(),frontKey,tagKey});
 const other=await save(e,{...record(),inventoryId:'FA-KEEP',frontKey:tagKey});
 const response=await handleApi(request('records/delete',{target:'app',id:r.id,revision:r.revision}),e,user);
 assert.equal(response.status,200);assert.equal((await response.json()).deleted,true);
 const listed=await (await handleApi(request('records'),e,user)).json();assert.deepEqual(listed.records.map(r=>r.id),[other.id]);
 assert.equal(await e.BUCKET.get(frontKey),null);assert.ok(await e.BUCKET.get(tagKey));
 assert.equal((await handleApi(request('media?key='+frontKey),e,user)).status,404);
 assert.equal((await handleApi(request('media?key='+tagKey),e,user)).status,200);
 const history=await (await handleApi(request('history?id='+r.id),e,user)).json();assert.equal(history[0].action,'deleted');assert.equal(history[0].by,user.email);
 assert.equal((await handleApi(request('export?kind=inventory&ids='+r.id),e,user)).status,400);
 assert.equal(outbound.mock.callCount(),0);
});

test('deletion rejects stale revisions and unauthorized requests without losing records',async()=>{
 const e=env(),r=await save(e,record());await save(e,{...r,notes:'Updated elsewhere'});
 assert.equal((await handleApi(request('records/delete',{target:'app',id:r.id,revision:1}),e,user)).status,409);
 assert.equal((await handleApi(request('records/delete',{target:'app',id:r.id,revision:2}),e,null)).status,401);
 assert.equal((await handleApi(request('records/delete',{target:'app',id:r.id}),e,user)).status,400);
 assert.equal((await (await handleApi(request('records'),e,user)).json()).records.length,1);
});

test('a stale device draft cannot recreate a deleted record',async()=>{
 const e=env(),r=await save(e,record());
 assert.equal((await handleApi(request('records/delete',{target:'app',id:r.id,revision:r.revision}),e,user)).status,200);
 assert.equal((await handleApi(request('records',r),e,user)).status,409);
 const {revision,...oldDraft}=r;
 assert.equal((await handleApi(request('records',oldDraft),e,user)).status,409);
 assert.equal((await (await handleApi(request('records'),e,user)).json()).records.length,0);
});

test('photo cleanup failure reports the completed record deletion honestly',async()=>{
 const e=env(),frontKey=await photo(e),r=await save(e,{...record(),frontKey});
 e.BUCKET.delete=async()=>{throw Error('Storage unavailable')};
 const response=await handleApi(request('records/delete',{target:'app',id:r.id,revision:r.revision}),e,user);
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{deleted:true,photosRetained:true});
 assert.equal((await (await handleApi(request('records'),e,user)).json()).records.length,0);
});

test('deletion rejects a KORONA, unknown or missing target without changing any saved data',async t=>{
 const outbound=t.mock.method(globalThis,'fetch',async()=>{throw Error('Deletion must not contact an external service')});
 for(const target of ['korona','all','',null,undefined]){
  const e=env(),frontKey=await photo(e),r=await save(e,{...record(),frontKey});
  const before=await e.DB.prepare('SELECT * FROM appliances WHERE id=?').bind(r.id).first();
  const auditBefore=await e.DB.prepare('SELECT * FROM audit').all();
  const mediaBefore=await e.DB.prepare('SELECT * FROM media').all();
  const response=await handleApi(request('records/delete',{id:r.id,revision:r.revision,target}),e,user);
  assert.equal(response.status,403,'for target '+String(target));
  assert.deepEqual(await e.DB.prepare('SELECT * FROM appliances WHERE id=?').bind(r.id).first(),before);
  assert.deepEqual(await e.DB.prepare('SELECT * FROM audit').all(),auditBefore);
  assert.deepEqual(await e.DB.prepare('SELECT * FROM media').all(),mediaBefore);
  assert.ok(await e.BUCKET.get(frontKey));
 }
 assert.equal(outbound.mock.callCount(),0);
});

test('processed Inventory cannot be deleted even by a direct app-only request or after archiving',async()=>{
 const e=env(),frontKey=await photo(e);
 let r=await save(e,{...record(),frontKey,exportedAt:'2026-10-12T15:00:00.000Z',exportKinds:['inventory']});
 for(const status of ['draft','archived']){
  r=await save(e,{...r,status});
  const before=await e.DB.prepare('SELECT * FROM appliances WHERE id=?').bind(r.id).first();
  const history=await e.DB.prepare('SELECT * FROM audit').all();
  const response=await handleApi(request('records/delete',{id:r.id,revision:r.revision,target:'app'}),e,user);
  assert.equal(response.status,409);assert.match((await response.json()).error,/cannot be deleted/i);
  assert.deepEqual(await e.DB.prepare('SELECT * FROM appliances WHERE id=?').bind(r.id).first(),before);
  assert.deepEqual(await e.DB.prepare('SELECT * FROM audit').all(),history);
  assert.ok(await e.BUCKET.get(frontKey));
 }
});
