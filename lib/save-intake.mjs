// Cloud persistence must still work if a browser denies IndexedDB or is out of quota.
export async function persistIntake(draft,{upload,saveRecord,writeLocal,onCheckpoint=(_draft)=>{}}){
 let current={...draft,record:{...draft.record}},localWarning=false;
 async function checkpoint(){onCheckpoint(current);try{await writeLocal(current)}catch{localWarning=true}}
 await checkpoint();
 for(const kind of ['front','tag']){
  if(!current[kind])continue;
  const key=await upload(current[kind],'photo');
  current={...current,record:{...current.record,[kind+'Key']:key},[kind]:undefined};
  await checkpoint();
 }
 const record=await saveRecord(current.record);
 try{await writeLocal(null)}catch{localWarning=true}
 return {record,localWarning};
}
