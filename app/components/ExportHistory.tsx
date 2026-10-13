import {useEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';
import {api,type Appliance} from '../../lib/types';
import {applyWorkflowResult,cacheExportEvent,localExportEvents,recordsForExport,type ExportEvent} from '../../lib/local-inventory';
import {prepareFiles,requestDownloads,type ExportFile} from '../../lib/export-files';
import {recordLabel} from '../../lib/numbering.mjs';
import Modal from './Modal';
export default function ExportHistory({records,initialReverse,onProcessed,onClose}:{records:Appliance[];initialReverse?:Appliance[];onProcessed:(records:Appliance[])=>void;onClose:()=>void}){
 const [events,setEvents]=useState<ExportEvent[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[reason,setReason]=useState(''),[notice,setNotice]=useState(''),[files,setFiles]=useState<ExportFile[]>([]);
 const [reversing,setReversing]=useState<{records:Appliance[];batchId?:string}|undefined>(initialReverse?{records:initialReverse}:undefined);
 const [affected,setAffected]=useState<Set<string>>(new Set());
 const attempt=useRef<{requestId:string;items:Array<{id:string;revision?:number}>;reason:string;batchId?:string}|undefined>(undefined),working=useRef(false),urls=useRef<string[]>([]);
 async function refresh(){
  try{const local=await localExportEvents();setEvents(local)}catch{}
  if(navigator.onLine)try{const result=await api<{events:ExportEvent[]}>('exports');setEvents(result.events);for(const event of result.events)try{await cacheExportEvent(event)}catch{}}catch(e){setError((e as Error).message)}
 }
 useEffect(()=>{void refresh();return ()=>{const saved=urls.current;setTimeout(()=>saved.forEach(url=>URL.revokeObjectURL(url)),60000)}},[]);
 async function download(event:ExportEvent){
  if(working.current)return;working.current=true;setBusy(true);setError('');
  try{
   const batch=navigator.onLine?(await api<{event:ExportEvent}>('exports/'+event.id)).event:(await localExportEvents()).find(e=>e.id===event.id);
   if(batch?.reversedIds?.length)throw Error('This batch has reversed items. Select the correct items in Recieving and create a new export.');
   if(!batch?.records)throw Error('Connect to download this export batch.');
   const created=prepareFiles(batch.records,batch.format!,batch.at);urls.current.push(...created.map(f=>f.url));setFiles(created);requestDownloads(created);
  }catch(e){setError((e as Error).message)}finally{working.current=false;setBusy(false)}
 }
 async function reverse(){
  if(!reversing||working.current)return;working.current=true;setBusy(true);setError('');
  try{
   if(!navigator.onLine)throw Error('Connect the desktop to reverse an export across devices.');
   if(reason.trim().length<3)throw Error('Enter a reason for reversing this export.');
   if(!attempt.current){const selected=await recordsForExport(reversing.records);attempt.current={requestId:crypto.randomUUID(),items:selected.map(r=>({id:r.id,revision:r.revision})),reason:reason.trim(),...(reversing.batchId?{batchId:reversing.batchId}:{})};}
   const result=await api<{event:ExportEvent;records:Appliance[]}>('exports/reverse',attempt.current);
   let cacheNote='';try{await applyWorkflowResult(result.records,attempt.current.items);await cacheExportEvent(result.event)}catch{cacheNote=' The server saved the reversal; this device could not cache it.'}
   onProcessed(result.records);setAffected(previous=>new Set([...previous,...result.records.map(r=>r.id)]));setNotice(result.records.length+' appliance(s) returned to Recieving. Their product numbers are unchanged.'+cacheNote);setReversing(undefined);setReason('');attempt.current=undefined;await refresh();
  }catch(e){setError((e as Error).message);if((e as {status?:number}).status&&((e as {status:number}).status<500))attempt.current=undefined}
  finally{working.current=false;setBusy(false)}
 }
 return <Modal label="Export history" className="compact-modal" onClose={()=>{if(!working.current)onClose()}}><header className="modal-head"><div><span className="eyebrow">DESKTOP EXPORT</span><h2>{reversing?'Reverse export':'Export history'}</h2></div><button className="icon-button" disabled={busy} onClick={onClose} aria-label="Close export history"><X/></button></header><div className="modal-content">
 {error?<p className="notice error" role="alert">{error}</p>:null}{notice?<p className="notice" role="status">{notice}</p>:null}
 {reversing?<><p>Return these {reversing.records.length} appliance(s) to Recieving on every device after sync. Their assigned numbers, photos, location and appliance status stay attached.</p><ul>{reversing.records.map(r=><li key={r.id}>{recordLabel(r)} · {r.brand} {r.type}</li>)}</ul><div className="field"><label htmlFor="reversalReason">Reason for reversal</label><textarea id="reversalReason" value={reason} maxLength={500} onChange={e=>setReason(e.target.value)}/></div><p className="notice">Files already downloaded remain on that computer. A completed KORONA import requires a separate correction there. This reversal sends no KORONA changes.</p><div className="button-row"><button className="button" disabled={busy} onClick={()=>{setReversing(undefined);attempt.current=undefined;setReason('')}}>Keep export</button><button className="button danger" disabled={busy||reason.trim().length<3||!navigator.onLine} onClick={()=>void reverse()}>{busy?'Reversing…':'Confirm reversal'}</button></div></>:<>
 <p className="small muted">Exports and reversals are recorded with the operator, time and affected items. Earlier exports may have no batch history; select them in Inventory to reverse them.</p>
 {!events.length?<p>No export history available{navigator.onLine?' yet.':' on this device. Connect to load it.'}</p>:null}
 {events.map(event=>{const active=records.filter(r=>r.exportedAt&&r.exportBatchId===event.id&&!affected.has(r.id));return <article className="export-history-entry" key={event.id}><h3>{event.kind==='reversal'?'Export reversed':'Export batch'} · {event.count} item{event.count===1?'':'s'}</h3><p>{new Date(event.at).toLocaleString()}<br/>{event.by}</p>{event.stores?.map(s=><p key={s.code}>{s.name}: {s.count}</p>)}{event.overrideReason?<p><strong>Mixed-store override:</strong> {event.overrideReason}</p>:null}{event.reason?<p><strong>Reason:</strong> {event.reason}</p>:null}{event.reversedIds?.length?<p className="notice">{event.reversedIds.length} item(s) reversed. Create a new export for corrected files.</p>:null}{event.kind==='export'?<div className="button-row"><button className="button" disabled={busy||Boolean(event.reversedIds?.length)} onClick={()=>void download(event)}>Download batch files</button><button className="button" disabled={busy||!active.length||!navigator.onLine} onClick={()=>{setReversing({records:active,batchId:event.id});setReason('');setError('')}}>Reverse {active.length} remaining</button></div>:null}</article>})}
 {files.length?<div className="export-files">{files.map(f=><a key={f.url} className="button" href={f.url} download={f.name}>Download {f.kind==='korona'?'KORONA':'inventory'} CSV</a>)}</div>:null}
 </>}
 </div></Modal>;
}
