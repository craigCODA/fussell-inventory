export function reconcileSyncedEntry(current,submitted,saved){
 if(current.version===submitted.version)return {...current,record:saved,state:'synced',error:'',syncedAt:Date.now()};
 // A save can finish while a newer edit is queued. Keep that edit and advance
 // only the revision it was based on, so the next upload is an update.
 if(current.record.revision===submitted.record.revision)return {...current,record:{...current.record,revision:saved.revision}};
 return current;
}

export async function syncQueuedEntry(entry,{upload,saveRecord,checkpoint,complete,fail}){
 let current=entry;
 try{
  for(const kind of ['front','tag']){
   if(!current[kind]||current.record[kind+'Key'])continue;
   const key=await upload(current[kind],'photo');
   current={...current,record:{...current.record,[kind+'Key']:key}};
   if(!await checkpoint(current))return {state:'superseded',authNeeded:false};
  }
  if(!await checkpoint(current))return {state:'superseded',authNeeded:false};
  const saved=await saveRecord(current.record);
  await complete(current,saved);
  return {state:'synced',authNeeded:false};
 }catch(error){
  const authNeeded=error.status===401||error.status===403;
  const state=error.status>=400&&error.status<500&&!authNeeded&&error.status!==429?'error':'pending';
  await fail(current,error.message||'Connection interrupted. Will retry.',state);
  return {state,authNeeded};
 }
}
