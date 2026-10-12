import {api,upload,type Appliance,type IntakeDraft} from './types';
import {syncQueuedEntry,reconcileSyncedEntry} from './sync-queue.mjs';

type Entry={id:string;record:Appliance;front?:Blob;tag?:Blob;version:string;state:'pending'|'synced'|'error';error?:string;savedAt:string;syncedAt?:number};
const channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('fussell-local-inventory'):undefined;
if(channel)channel.onmessage=()=>window.dispatchEvent(new Event('inventory-local-change'));
const changed=()=>{window.dispatchEvent(new Event('inventory-local-change'));channel?.postMessage('changed')};
function open():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{
 const request=indexedDB.open('fussell-inventory',1);
 request.onupgradeneeded=()=>request.result.createObjectStore('records',{keyPath:'id'});
 request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result)};
 request.onerror=()=>reject(request.error);
 request.onblocked=()=>reject(Error('Close another inventory tab to update device storage.'));
})}
async function allEntries():Promise<Entry[]>{const db=await open();return new Promise((resolve,reject)=>{
 const tx=db.transaction('records','readonly'),request=tx.objectStore('records').getAll();
 tx.oncomplete=()=>{db.close();resolve(request.result)};tx.onerror=()=>{db.close();reject(tx.error)};tx.onabort=()=>{db.close();reject(tx.error||Error('Device storage was interrupted.'))};
})}
async function mutate(id:string,update:(entry:Entry|undefined)=>Entry|undefined):Promise<Entry|undefined>{
 const db=await open();return new Promise((resolve,reject)=>{
  const tx=db.transaction('records','readwrite'),store=tx.objectStore('records'),request=store.get(id);let result:Entry|undefined;
  request.onsuccess=()=>{result=update(request.result);if(result)store.put(result);else store.delete(id)};
  tx.oncomplete=()=>{db.close();changed();resolve(result)};tx.onerror=()=>{db.close();reject(tx.error)};tx.onabort=()=>{db.close();reject(tx.error||Error('Device save was interrupted.'))};
 });
}
function client(entry:Entry):Appliance{return {...entry.record,syncState:entry.state,syncError:entry.error,localFront:entry.front,localTag:entry.tag}}
export async function localRecords(){return (await allEntries()).sort((a,b)=>b.savedAt.localeCompare(a.savedAt)).map(client)}
export async function queueIntake(draft:IntakeDraft){
 const {localFront,localTag,syncState,syncError,...record}=draft.record;
 const entry=await mutate(record.id,previous=>({id:record.id,record:{...record,revision:record.revision??previous?.record.revision},front:draft.front??localFront,tag:draft.tag??localTag,version:crypto.randomUUID(),state:'pending',error:'',savedAt:new Date().toISOString()}));
 // Ask the browser to retain offline records; denial never pretends the save failed.
 void navigator.storage?.persist?.().catch(()=>false);
 return client(entry!);
}
export async function mergeRemoteRecords(records:Appliance[],snapshotStarted=Date.now()){
 const db=await open();await new Promise<void>((resolve,reject)=>{
  const tx=db.transaction('records','readwrite'),store=tx.objectStore('records'),request=store.getAll();
  request.onsuccess=()=>{
   const local=new Map<string,Entry>(request.result.map((e:Entry)=>[e.id,e])),ids=new Set(records.map(r=>r.id));
   for(const record of records){const previous=local.get(record.id);if(previous&&(previous.state!=='synced'||(previous.syncedAt||0)>snapshotStarted))continue;
    store.put({id:record.id,record,version:previous?.version||crypto.randomUUID(),state:'synced',error:'',syncedAt:Date.now(),savedAt:record.updatedAt||new Date().toISOString(),front:previous?.record.frontKey===record.frontKey?previous?.front:undefined,tag:previous?.record.tagKey===record.tagKey?previous?.tag:undefined});
   }
   for(const previous of local.values())if(previous.state==='synced'&&(previous.syncedAt||0)<=snapshotStarted&&!ids.has(previous.id))store.delete(previous.id);
  };
  tx.oncomplete=()=>{db.close();changed();resolve()};tx.onerror=()=>{db.close();reject(tx.error)};tx.onabort=()=>{db.close();reject(tx.error||Error('Device storage was interrupted.'))};
 });
 return localRecords();
}
export async function removeLocalRecord(id:string){await mutate(id,()=>undefined)}
let running:Promise<{authNeeded:boolean}>|undefined;
export function syncInventory(retryErrors=false):Promise<{authNeeded:boolean}>{
 if(running)return running;
 const drain=async()=>{
  let authNeeded=false;
  for(const entry of await allEntries()){
   if(entry.state==='synced'||entry.state==='error'&&!retryErrors)continue;
   if(!navigator.onLine)break;
   const result=await syncQueuedEntry(entry,{
    upload,saveRecord:(r:Appliance)=>api<Appliance>('records',r),
    checkpoint:async(next:Entry)=>{let accepted=false;await mutate(next.id,current=>{if(current?.version!==next.version)return current;accepted=true;return next});return accepted},
    complete:async(sent:Entry,saved:Appliance)=>{await mutate(sent.id,current=>current?reconcileSyncedEntry(current,sent,saved) as Entry:undefined)},
    fail:async(sent:Entry,error:string,state:'pending'|'error')=>{await mutate(sent.id,current=>current?.version===sent.version?{...current,state,error}:current)}
   });
   authNeeded||=result.authNeeded;
   if(result.state==='pending')break;
  }
  return {authNeeded};
 };
 // Web Locks serializes uploads across tabs. Version checks also protect edits
 // in browsers without Web Locks, and the API rejects stale server revisions.
 const operation=(async()=>navigator.locks?await navigator.locks.request('fussell-upload',{ifAvailable:true},async lock=>lock?await drain():{authNeeded:false}):await drain())();
 running=operation.finally(()=>{running=undefined});return running;
}
