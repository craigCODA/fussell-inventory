import {readyErrors} from './domain.mjs';
import {STORES,currentStore,numberingDetails,isProcessed} from './numbering.mjs';

export const canExport=(env,user)=>Boolean(user?.email&&String(env.EXPORTER_EMAIL||'').trim().toLowerCase()===user.email.trim().toLowerCase());
export const exportConfigured=env=>Boolean(String(env.EXPORTER_EMAIL||'').trim());
const fail=(message,status=400,extra={})=>Object.assign(Error(message),{status,...extra});
const unpack=row=>({...JSON.parse(row.payload),revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at,updatedBy:row.updated_by});
const uuid=value=>typeof value==='string'&&/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value);
const eventKey=(kind,id)=>'inventory-'+kind+':'+id;
const getEvent=async(db,key)=>{const r=await db.prepare('SELECT value FROM settings WHERE key=?').bind(key).first();return r?JSON.parse(r.value):null};
const readRecords=async(db,ids)=>(await db.prepare('SELECT * FROM appliances WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)).all()).results.map(unpack);
function selection(input){
 if(!uuid(input.requestId))throw fail('Invalid export request. Reopen the export window.');
 if(!Array.isArray(input.items)||!input.items.length||input.items.length>100)throw fail('Select between 1 and 100 appliances per export batch.');
 if(input.items.some(r=>!uuid(r.id)||!Number.isSafeInteger(r.revision)||r.revision<1)||new Set(input.items.map(r=>r.id)).size!==input.items.length)throw fail('Sync the selected appliances before exporting.');
 return input.items.map(({id,revision})=>({id,revision}));
}
function guard(db,key,event,items){
 // NOT NULL is an assertion inside the same transaction as every subsequent
 // write. A stale/missing record aborts the entire batch, including counters.
 return db.prepare(`INSERT INTO settings(key,value) VALUES (?,CASE WHEN
  (SELECT COUNT(*) FROM json_each(?) i JOIN appliances a ON a.id=json_extract(i.value,'$.id') AND a.revision=json_extract(i.value,'$.revision'))=?
  THEN ? ELSE NULL END)`).bind(key,JSON.stringify(items),items.length,JSON.stringify(event));
}
function fingerprint(input){return JSON.stringify(input)}
async function replay(db,key,request){
 const previous=await getEvent(db,key);if(!previous)return null;
 if(previous.kind==='export'&&previous.reversedIds?.length)throw fail('This export was reversed. Review the items and create a new export.',409);
 if(previous.request!==request)throw fail('This export request was already used with different choices. Close the window and try again.',409);
 return {event:previous,records:await readRecords(db,previous.recordIds)};
}
export async function handleExports(request,env,user,route){
 if(!canExport(env,user))throw fail(exportConfigured(env)?'Only the designated exporter can export or reverse exports.':'An exporter has not been configured. Set EXPORTER_EMAIL in the Worker settings.',403);
 const db=env.DB;
 if(route==='exports'&&request.method==='GET'){
  const rows=await db.prepare("SELECT json_remove(value,'$.records','$.request') AS value FROM settings WHERE key LIKE 'inventory-export:%' OR key LIKE 'inventory-reversal:%' ORDER BY json_extract(value,'$.at') DESC LIMIT 100").all();
  return {events:rows.results.map(r=>JSON.parse(r.value))};
 }
 if(/^exports\/[a-f\d-]{36}$/i.test(route)&&request.method==='GET'){
  const event=await getEvent(db,eventKey('export',route.split('/')[1]));if(!event)throw fail('Export batch not found.',404);return {event};
 }
 if(!['exports','exports/reverse'].includes(route)||request.method!=='POST')throw fail('Not found.',404);
 const requestText=await request.text();if(requestText.length>32000)throw fail('Export request is too large.',413);
 const input=JSON.parse(requestText),items=selection(input),ids=items.map(r=>r.id),reverse=route==='exports/reverse',kind=reverse?'reversal':'export';
 const key=eventKey(kind,input.requestId),requestPrint=fingerprint(input),existing=await replay(db,key,requestPrint);if(existing)return existing;
 const saved=await readRecords(db,ids),byId=new Map(saved.map(r=>[r.id,r])),records=ids.map(id=>byId.get(id));
 if(records.some((r,i)=>!r||r.revision!==items[i].revision))throw fail('The selected items changed or have not synced. Refresh and review them before continuing.',409);
 const at=new Date().toISOString(),by=user.email;
 if(reverse){
  const reason=typeof input.reason==='string'?input.reason.trim():'';
  if(reason.length<3||reason.length>500)throw fail('Enter a reversal reason between 3 and 500 characters.');
  if(records.some(r=>!r.exportedAt))throw fail('Select currently exported items to reverse. Their processing state may have changed.',409);
  if(input.batchId&&records.some(r=>r.exportBatchId!==input.batchId))throw fail('Some items now belong to another export. Refresh export history before reversing.',409);
  const event={id:input.requestId,kind,at,by,reason,recordIds:ids,count:ids.length,originalBatches:[...new Set(records.map(r=>r.exportBatchId||'legacy'))],request:requestPrint};
  const reversal={id:input.requestId,at,by,reason};
  const statements=[guard(db,key,event,items),db.prepare(`UPDATE appliances SET payload=json_patch(payload,json_object(
   'exportedAt',NULL,'exportKinds',NULL,'exportBatchId',NULL,'processedOnce',json('true'),
   'exportReversal',json(?),'workflowRevision',COALESCE(json_extract(payload,'$.workflowRevision'),0)+1)),
   revision=revision+1,updated_at=?,updated_by=? WHERE id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(reversal),at,by,JSON.stringify(ids)),
   db.prepare(`UPDATE settings SET value=json_set(value,'$.reversedIds',json((SELECT json_group_array(id) FROM (
    SELECT value AS id FROM json_each(COALESCE(json_extract(settings.value,'$.reversedIds'),'[]'))
    UNION SELECT j.value AS id FROM json_each(?) j WHERE j.value IN (SELECT value FROM json_each(json_extract(settings.value,'$.recordIds')))
   )))) WHERE key IN (SELECT 'inventory-export:'||value FROM json_each(?))`).bind(JSON.stringify(ids),JSON.stringify(event.originalBatches.filter(id=>id!=='legacy'))),
   db.prepare("INSERT INTO audit(record_id,action,at,by) SELECT value,?,?,? FROM json_each(?)").bind('export reversed: '+input.requestId+'; '+reason,at,by,JSON.stringify(ids))];
  try{await db.batch(statements)}catch(e){const repeated=await replay(db,key,requestPrint);if(repeated)return repeated;if(/NOT NULL constraint failed/.test(e.message))throw fail('An item changed before reversal. Refresh and review it again.',409);throw e}
  return {event,records:await readRecords(db,ids)};
 }
 if(!['both','inventory','korona'].includes(input.kind))throw fail('Choose an export format.');
 const eligible=records.filter(r=>r.status==='ready'&&!readyErrors(r).length),eligibleIds=new Set(eligible.map(r=>r.id));
 if(input.kind!=='inventory'&&!eligible.length)throw fail('Select complete, reviewed ready items for the KORONA export.');
 if(input.kind==='korona'&&eligible.length!==records.length)throw fail('The KORONA export can include only complete, reviewed ready items.');
 const stores=STORES.map(s=>({...s,count:records.filter(r=>currentStore(r)===s.code).length})).filter(s=>s.count);
 if(stores.reduce((n,s)=>n+s.count,0)!==records.length)throw fail('Choose a current store for every selected appliance before exporting.');
 const overrideReason=typeof input.overrideReason==='string'?input.overrideReason.trim():'';
 if(stores.length>1&&(overrideReason.length<3||overrideReason.length>500))throw fail('Multiple stores selected. Review the selection or enter a reason to override this export.',409,{code:'mixed_stores',stores});
 const groups=new Map();
 const plans=records.map(r=>{
  const needsNumber=!isProcessed(r),details=needsNumber?numberingDetails(r):{};
  const offset=needsNumber?(groups.get(details.prefix)||0)+1:0;if(needsNumber)groups.set(details.prefix,offset);
  return {id:r.id,needsNumber,...details,offset,kinds:input.kind==='both'?(eligibleIds.has(r.id)?['inventory','korona']:['inventory']):[input.kind]};
 });
 for(const plan of plans)plan.groupCount=groups.get(plan.prefix)||0;
 // D1 limits a row to 2 MB. Leave headroom for permanent IDs, workflow
 // metadata and the request ledger; reject before any transactional writes.
 const snapshotSize=new TextEncoder().encode(JSON.stringify(records.map(({ocrText,...record})=>record))).length;
 if(snapshotSize>1750000)throw fail('This batch contains too much text for one export. Select fewer appliances and export smaller groups.');
 const event={id:input.requestId,kind,format:input.kind,at,by,overrideReason:stores.length>1?overrideReason:'',stores,recordIds:ids,count:ids.length,request:requestPrint};
 const counters=[...groups].map(([prefix,count])=>({prefix,count}));
 const statements=[guard(db,key,event,items)];
 if(counters.length)statements.push(db.prepare(`INSERT INTO settings(key,value)
  SELECT 'inventory-counter:'||json_extract(g.value,'$.prefix'),CAST(MAX(
   COALESCE((SELECT CAST(s.value AS INTEGER) FROM settings s WHERE s.key='inventory-counter:'||json_extract(g.value,'$.prefix')),0),
   COALESCE((SELECT MAX(CAST(substr(a.inventory_id,16) AS INTEGER)) FROM appliances a
    WHERE substr(a.inventory_id,1,15)=json_extract(g.value,'$.prefix') AND length(a.inventory_id)>=18
    AND substr(a.inventory_id,16) NOT GLOB '*[^0-9]*'),0)
  )+json_extract(g.value,'$.count') AS TEXT) FROM json_each(?) g WHERE true
  ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(JSON.stringify(counters)));
 statements.push(db.prepare(`WITH plans AS (SELECT value AS p FROM json_each(?)), numbered AS (
  SELECT p,CASE WHEN json_extract(p,'$.needsNumber') THEN json_extract(p,'$.prefix')||printf('%03d',
   (SELECT CAST(value AS INTEGER) FROM settings WHERE key='inventory-counter:'||json_extract(p,'$.prefix'))-json_extract(p,'$.groupCount')+json_extract(p,'$.offset'))
   ELSE NULL END AS new_id FROM plans)
  UPDATE appliances SET inventory_id=COALESCE(numbered.new_id,appliances.inventory_id),
   payload=json_patch(appliances.payload,json_object(
    'inventoryId',COALESCE(numbered.new_id,appliances.inventory_id),
    'numberAssignedAt',CASE WHEN numbered.new_id IS NOT NULL THEN ? ELSE json_extract(payload,'$.numberAssignedAt') END,
    'numberType',COALESCE(json_extract(numbered.p,'$.numberType'),json_extract(payload,'$.numberType')),
    'receivingStore',COALESCE(json_extract(numbered.p,'$.receivingStore'),json_extract(payload,'$.receivingStore')),
    'receivedDate',COALESCE(json_extract(numbered.p,'$.receivedDate'),json_extract(payload,'$.receivedDate')),
    'exportedAt',?,'exportKinds',json_extract(numbered.p,'$.kinds'),'exportBatchId',?,'processedOnce',json('true'),
    'workflowRevision',COALESCE(json_extract(payload,'$.workflowRevision'),0)+1)),
   revision=revision+1,updated_at=?,updated_by=? FROM numbered WHERE appliances.id=json_extract(numbered.p,'$.id')`).bind(JSON.stringify(plans),at,at,input.requestId,at,by));
 statements.push(db.prepare('INSERT INTO audit(record_id,action,at,by) SELECT value,?,?,? FROM json_each(?)').bind('exported: '+input.requestId+(stores.length>1?'; mixed-store override: '+overrideReason:''),at,by,JSON.stringify(ids)));
 statements.push(db.prepare(`UPDATE settings SET value=json_set(value,'$.records',json((SELECT json_group_array(json(json_remove(json_set(payload,
  '$.revision',revision,'$.createdAt',created_at,'$.updatedAt',updated_at,'$.updatedBy',updated_by),'$.ocrText')))
  FROM appliances WHERE id IN (SELECT value FROM json_each(?))))) WHERE key=?`).bind(JSON.stringify(ids),key));
 try{await db.batch(statements)}catch(e){const repeated=await replay(db,key,requestPrint);if(repeated)return repeated;if(/NOT NULL constraint failed/.test(e.message))throw fail('An item changed before export. Refresh and review it again.',409);throw e}
 return {event:await getEvent(db,key),records:await readRecords(db,ids)};
}
