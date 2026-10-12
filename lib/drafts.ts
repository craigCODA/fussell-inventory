import type {IntakeDraft} from './types';
function db():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const request=indexedDB.open('fussell-intake',1);request.onupgradeneeded=()=>request.result.createObjectStore('drafts');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
export async function readDraft():Promise<IntakeDraft|undefined>{const d=await db();return new Promise((resolve,reject)=>{const t=d.transaction('drafts','readonly');const r=t.objectStore('drafts').get('active');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);t.oncomplete=()=>d.close();});}
async function writeDraft(value:IntakeDraft|null){const d=await db();return new Promise<void>((resolve,reject)=>{const t=d.transaction('drafts','readwrite');if(value)t.objectStore('drafts').put(value,'active');else t.objectStore('drafts').delete('active');t.oncomplete=()=>{d.close();resolve()};t.onerror=()=>{d.close();reject(t.error)};});}

let writes:Promise<void>=Promise.resolve();
export function saveDraft(value:IntakeDraft|null){const operation=writes.catch(()=>{}).then(()=>writeDraft(value));writes=operation;return operation;}
