import test from 'node:test';import assert from 'node:assert/strict';import {env} from './helpers/storage.mjs';
import {handleApi} from '../lib/service.mjs';

const user={userId:'operator-1',email:'operator@example.com'};
const rec=(id='a118d0ab-bafe-4800-b479-44a2aa113acf')=>({id,inventoryId:'FA-TEST',status:'draft',type:'Dryer',brand:'Samsung',serial:'0ABC',model:'DV-1234',price:'399',cost:'100'});
const req=(path,body,method=body?'POST':'GET')=>new Request('https://app.test/api/'+path,{method,...body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{}});
test('all API access requires identity',async()=>assert.equal((await handleApi(req('records'),env(),null)).status,401));
test('persist real records, repeat create safely, detect stale versions',async()=>{const e=env();const a=await handleApi(req('records',rec()),e,user);assert.equal(a.status,200);const r=await a.json();assert.equal(r.revision,1);
 assert.equal((await (await handleApi(req('records',rec()),e,user)).json()).revision,1);
 const changed={...rec(),price:'450',revision:1};assert.equal((await handleApi(req('records',changed),e,user)).status,200);
 assert.equal((await handleApi(req('records',{...changed,price:'475'}),e,user)).status,409);
 const listed=await (await handleApi(req('records'),e,user)).json();assert.equal(listed.records.length,1);assert.equal(listed.records[0].price,'450');});
test('reject duplicate inventory IDs and same brand serial',async()=>{const e=env();await handleApi(req('records',rec()),e,user);
 assert.equal((await handleApi(req('records',{...rec('a118d0ab-bafe-4800-b479-44a2aa113acd'),inventoryId:'FA-OTHER'}),e,user)).status,409);
 assert.equal((await handleApi(req('records',{...rec('a118d0ab-bafe-4800-b479-44a2aa113acc'),serial:'DIFFERENT'}),e,user)).status,409);});
test('reject ready records without required photos and reject foreign file references',async()=>{const e=env();assert.equal((await handleApi(req('records',{...rec(),status:'ready'}),e,user)).status,400);assert.equal((await handleApi(req('records',{...rec(),frontKey:'photos/nonexistent'}),e,user)).status,400)});
test('drafts cannot be exported as KORONA products',async()=>{const e=env();await handleApi(req('records',rec()),e,user);const r=await handleApi(req('export?kind=korona&ids='+rec().id),e,user);assert.equal(r.status,400)});
test('file upload enforces image signatures; stored photos can be fetched',async()=>{const e=env();const data=new FormData();data.set('kind','photo');data.set('file',new Blob(['<svg/>'],{type:'image/png'}),'bad.png');assert.equal((await handleApi(new Request('https://app.test/api/upload',{method:'POST',body:data}),e,user)).status,400);
 const ok=new FormData();ok.set('kind','photo');ok.set('file',new Blob([new Uint8Array([255,216,255,224,1,2,3])],{type:'image/jpeg'}),'photo.jpg');const r=await handleApi(new Request('https://app.test/api/upload',{method:'POST',body:ok}),e,user);assert.equal(r.status,200);const f=await r.json();assert.equal((await handleApi(req('media?key='+encodeURIComponent(f.key)),e,user)).status,200);});
