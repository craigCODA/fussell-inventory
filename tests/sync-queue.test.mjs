import test from 'node:test';
import assert from 'node:assert/strict';
import {syncQueuedEntry,reconcileSyncedEntry} from '../lib/sync-queue.mjs';

const entry=()=>({version:'a',state:'pending',record:{id:'one',brand:'Original',frontKey:'',tagKey:''},front:new Blob(['front']),tag:new Blob(['tag'])});
test('retry keeps successful photo uploads and retains local photos',async()=>{
 let stored=entry(),uploads=0,saves=0;
 const operations={upload:async()=>{if(++uploads===2)throw Error('Disconnected');return 'photos/'+uploads},saveRecord:async r=>{saves++;return {...r,revision:1}},checkpoint:async e=>{stored=e;return true},complete:async(e,r)=>{stored=reconcileSyncedEntry(stored,e,r)},fail:async(e,message,state)=>{stored={...stored,state,error:message}}};
 assert.equal((await syncQueuedEntry(stored,operations)).state,'pending');assert.equal(stored.record.frontKey,'photos/1');assert.equal(saves,0);
 assert.equal((await syncQueuedEntry(stored,operations)).state,'synced');assert.equal(uploads,3);assert.equal(saves,1);assert.equal(await stored.front.text(),'front');assert.equal(await stored.tag.text(),'tag');
});
test('a record edited while uploading is not replaced by the older upload',async()=>{
 let saves=0;const result=await syncQueuedEntry(entry(),{upload:async()=> 'photos/one',checkpoint:async()=>false,saveRecord:async()=>{saves++},complete:async()=>{},fail:async()=>{}});
 assert.equal(result.state,'superseded');assert.equal(saves,0);
});
test('a newer local edit survives a completed server save and inherits its revision',()=>{
 const submitted=entry(),newer={...submitted,version:'b',record:{...submitted.record,brand:'New edit'}};
 const result=reconcileSyncedEntry(newer,submitted,{...submitted.record,revision:1});
 assert.equal(result.state,'pending');assert.equal(result.record.brand,'New edit');assert.equal(result.record.revision,1);
});
test('conflicts need attention while expired authentication remains retryable',async()=>{
 for(const status of [409,401]){
  let failure;const result=await syncQueuedEntry({...entry(),front:undefined,tag:undefined},{upload:async()=>{},saveRecord:async()=>{throw Object.assign(Error('Server refused'),{status})},checkpoint:async()=>true,complete:async()=>{},fail:async(e,message,state)=>{failure=state}});
  assert.equal(failure,status===409?'error':'pending');assert.equal(result.authNeeded,status===401);
 }
});
