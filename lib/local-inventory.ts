import {mergeWorkflow,workflowFields,isProcessed} from './numbering.mjs';
import {api,upload,type Appliance,type IntakeDraft} from './types';
import {syncQueuedEntry,reconcileSyncedEntry} from './sync-queue.mjs';

type Entry={id:string;record:Appliance;front?:Blob;tag?:Blob;version:string;state:'pending'|'synced'|'error';error?:string;savedAt:string;syncedAt?:number};
const channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('fussell-local-inventory'):undefined;
if(channel)channel.onmessage=()=>window.dispatchEvent(new Event('inventory-local-change'));
const changed=()=>{window.dispatchEvent(new Event('inventory-local-change'));channel?.postMessage('changed')};
function open():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{
 const request=indexedDB.open('fussell-inventory',2);
 request.onupgradeneeded=()=>{for(const name of ['records','exports'])if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name,{keyPath:'id'})};
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
 const entry=await mutate(record.id,previous=>({id:record.id,record:{...record,revision:record.revision??previous?.record.revision,...(previous&&isProcessed(previous.record)?workflowFields(previous.record):{})},front:draft.front??localFront,tag:draft.tag??localTag,version:crypto.randomUUID(),state:'pending',error:'',savedAt:new Date().toISOString()}));
 // Ask the browser to retain offline records; denial never pretends the save failed.
 void navigator.storage?.persist?.().catch(()=>false);
 return client(entry!);
}
export type ExportEvent={id:string;kind:'export'|'reversal';at:string;by:string;recordIds:string[];count:number;format?:'inventory'|'korona'|'both';records?:Appliance[];stores?:Array<{code:string;name:string;count:number}>;reason?:string;overrideReason?:string;originalBatches?:string[];reversedIds?:string[]};
export async function cacheExportEvent(event:ExportEvent){
 const db=await open();return new Promise<void>((resolve,reject)=>{
  const tx=db.transaction('exports','readwrite'),store=tx.objectStore('exports'),request=store.get(event.id);
  request.onsuccess=()=>{const previous=request.result as ExportEvent|undefined;store.put({...previous,...event,...(previous?.reversedIds||event.reversedIds?{reversedIds:[...new Set([...(previous?.reversedIds||[]),...(event.reversedIds||[])])]}:{})})};
  if(event.kind==='reversal')for(const id of event.originalBatches||[]){const original=store.get(id);original.onsuccess=()=>{const batch=original.result as ExportEvent|undefined;if(batch)store.put({...batch,reversedIds:[...new Set([...(batch.reversedIds||[]),...event.recordIds.filter(id=>batch.recordIds.includes(id))])]})}};
  tx.oncomplete=()=>{db.close();resolve()};tx.onabort=tx.onerror=()=>{db.close();reject(tx.error)};
 });
}
export async function localExportEvents():Promise<ExportEvent[]>{
 const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('exports','readonly'),request=tx.objectStore('exports').getAll();tx.oncomplete=()=>{db.close();resolve(request.result.sort((a:ExportEvent,b:ExportEvent)=>b.at.localeCompare(a.at)))};tx.onabort=tx.onerror=()=>{db.close();reject(tx.error)}});
}
export async function applyWorkflowResult(records:Appliance[],expected:Array<{id:string;revision?:number}>){
 const revisions=new Map(expected.map(r=>[r.id,r.revision]));
 for(const record of records)await mutate(record.id,current=>{
  if(!current)return {id:record.id,record,version:crypto.randomUUID(),state:'synced',savedAt:record.updatedAt||new Date().toISOString(),syncedAt:Date.now()};
  if((current.record.revision||0)>(record.revision||0))return current;
  const edited=current.state!=='synced';
  return {...current,record:edited?{...mergeWorkflow(current.record,record),revision:current.record.revision===revisions.get(record.id)?record.revision:current.record.revision}:record,version:crypto.randomUUID(),state:edited?current.state:'synced',syncedAt:Date.now()};
 });
 return localRecords();
}
export async function recordsForExport(selection:Appliance[]){
 if(!navigator.onLine)throw Error('Connect the desktop to process an export. Receiving and photos remain saved offline.');
 await syncInventory();
 const records=await localRecords(),byId=new Map(records.map(r=>[r.id,r]));
 return selection.map(original=>{
  const current=byId.get(original.id);
  if(!current||current.syncState!=='synced'||!current.revision)throw Error('Sync each selected appliance before exporting. '+(current?.syncError||'Your items remain on this device.'));
  for(const field of ['type','fuel','storeCode','receivingStore','receivedDate','brand','model','serial','status','price','cost','condition','testStatus','location','bin','notes'] as const)if((current[field]||'')!==(original[field]||''))throw Error('A selected appliance changed. Close export and review your selection again.');
  return current;
 });
}
export async function mergeRemoteRecords(records:Appliance[],snapshotStarted=Date.now()){
 const db=await open();await new Promise<void>((resolve,reject)=>{
  const tx=db.transaction('records','readwrite'),store=tx.objectStore('records'),request=store.getAll();
  request.onsuccess=()=>{
   const local=new Map<string,Entry>(request.result.map((e:Entry)=>[e.id,e])),ids=new Set(records.map(r=>r.id));
   for(const record of records){const previous=local.get(record.id);if(previous&&(previous.state!=='synced'||(previous.syncedAt||0)>snapshotStarted)){
     if(previous.state!=='synced'&&(record.workflowRevision||0)>(previous.record.workflowRevision||0))store.put({...previous,record:mergeWorkflow(previous.record,record),version:crypto.randomUUID()});
     continue;
    }
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
