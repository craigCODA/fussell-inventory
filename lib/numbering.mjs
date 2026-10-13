export const STORES=[{code:'BA',name:'Ball · K&T Appliances'},{code:'AL',name:'Alexandria · Fussell Appliances'}];
export const SERVER_FIELDS=['exportedAt','exportKinds','exportBatchId','exportReversal','workflowRevision','processedOnce','numberAssignedAt','numberType'];
export const isProcessed=r=>Boolean(r.numberAssignedAt||r.processedOnce||r.exportedAt);
export const storeFromLocation=location=>/\bball\b/i.test(location||'')?'BA':/\balexandria\b|\bmasonic\b/i.test(location||'')?'AL':'';
export const currentStore=r=>r.storeCode||storeFromLocation(r.location);
/** @param {string | Date} [value] */
export const localDate=(value=new Date())=>{const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value)).map(p=>[p.type,p.value]));return parts.year+'-'+parts.month+'-'+parts.day;};
export function validDate(value){return typeof value==='string'&&/^\d{4}-\d\d-\d\d$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
export function typeCode(r){
 const fuel=r.fuel==='Electric'?'E':r.fuel==='Gas'?'G':'';
 if(['Dryer','Oven','Range'].includes(r.type))return fuel?({Dryer:'D',Oven:'O',Range:'R'}[r.type]+fuel):'';
 return {Washer:'WM',Dishwasher:'DW',Refrigerator:'RF',Freezer:'DF',Microwave:'MW',Other:'OT'}[r.type]||'';
}
export function numberingDetails(r){
 const code=typeCode(r),store=r.receivingStore||currentStore(r),date=r.receivedDate||(r.createdAt?localDate(r.createdAt):'');
 if(!code)throw Error('Choose the appliance type and electric/gas fuel, where applicable, before exporting.');
 if(!STORES.some(s=>s.code===store))throw Error('Choose the receiving store before exporting.');
 if(!validDate(date))throw Error('Choose a valid receiving date before exporting.');
 return {numberType:code,receivingStore:store,receivedDate:date,prefix:'FA-'+code+store+date.replaceAll('-','')};
}
export function workflowFields(r){
 const fields=Object.fromEntries(SERVER_FIELDS.map(k=>[k,r[k]]));
 if(isProcessed(r))Object.assign(fields,{inventoryId:r.inventoryId,receivingStore:r.receivingStore,receivedDate:r.receivedDate});
 return fields;
}
export function mergeWorkflow(local,remote){
 if((remote.workflowRevision||0)<(local.workflowRevision||0))return local;
 return {...local,...workflowFields(remote)};
}
export const recordLabel=r=>r.inventoryId?.startsWith('TMP-')?'Pending export · '+r.id.slice(0,8).toUpperCase():r.inventoryId;
