import {useEffect,useRef,useState} from 'react';
import {ArrowDownToLine,ChevronRight,X} from 'lucide-react';
import {readyErrors} from '../../lib/domain.mjs';
import {STORES,currentStore,recordLabel} from '../../lib/numbering.mjs';
import {applyWorkflowResult,cacheExportEvent,recordsForExport,type ExportEvent} from '../../lib/local-inventory';
import {prepareFiles,requestDownloads,type ExportFile} from '../../lib/export-files';
import {api,type Appliance} from '../../lib/types';
import Modal from './Modal';

type Kind='inventory'|'korona'|'both';
type Attempt={requestId:string;kind:Kind;items:Array<{id:string;revision?:number}>;overrideReason:string};
export default function ExportModal({records,onProcessed,onClose,onInventory}:{records:Appliance[];onProcessed:(updated:Appliance[])=>void;onClose:()=>void;onInventory:()=>void}){
 const [selection]=useState(()=>records),[busy,setBusy]=useState(false),[error,setError]=useState(''),[note,setNote]=useState(''),[files,setFiles]=useState<ExportFile[]>([]),[reason,setReason]=useState('');
 const [finished,setFinished]=useState(false),[batchId,setBatchId]=useState('');
 const working=useRef(false),urls=useRef<string[]>([]),attempt=useRef<Attempt|undefined>(undefined);
 const ready=selection.filter(r=>r.status==='ready'&&!readyErrors({...r,frontKey:r.frontKey||(r.localFront?'local-photo':''),tagKey:r.tagKey||(r.localTag?'local-photo':'')}).length);
 const stores=STORES.map(s=>({...s,count:selection.filter(r=>currentStore(r)===s.code).length})).filter(s=>s.count),mixed=stores.length>1;
 const offline=!navigator.onLine,canCopyOffline=selection.every(r=>r.exportedAt);
 useEffect(()=>()=>{const created=urls.current;setTimeout(()=>created.forEach(url=>URL.revokeObjectURL(url)),60000)},[]);
 async function download(kind:Kind){
  if(working.current)return;working.current=true;setBusy(true);setError('');setNote('');
  try{
   if(!selection.length||kind!=='inventory'&&!ready.length)throw Error('Select complete, reviewed ready items for the KORONA export.');
   if(mixed&&reason.trim().length<3&&!offline)throw Error('Review the selection or give a reason for exporting multiple stores together.');
   let rows:Appliance[],at:string;
   if(!navigator.onLine){
    if(!canCopyOffline)throw Error('Connect the desktop to process this export. All received items and photos remain saved.');
    rows=kind==='korona'?ready:selection;at=new Date().toISOString();setNote('Offline copies downloaded. Processing state has not changed.');
   }else{
    if(!attempt.current){
     const selected=await recordsForExport(kind==='korona'?ready:selection);
     attempt.current={requestId:crypto.randomUUID(),kind,items:selected.map(r=>({id:r.id,revision:r.revision})),overrideReason:mixed?reason.trim():''};
    }
    if(attempt.current.kind!==kind)throw Error('Retry the previous export format, or close this window before changing formats.');
    const request=attempt.current;
    const result=await api<{event:ExportEvent;records:Appliance[]}>('exports',request);
    rows=result.event.records!;at=result.event.at;setBatchId(result.event.id);
    try{await applyWorkflowResult(result.records,request.items);await cacheExportEvent(result.event)}catch{setNote('The server saved this export. This device could not cache it; reconnect to view it again.');}
    onProcessed(result.records);
   }
   const created=prepareFiles(rows,kind,at);urls.current.push(...created.map(f=>f.url));setFiles(created);requestDownloads(created);setFinished(true);
  }catch(e){setError(e instanceof Error?e.message:'Export failed. Your items remain saved.');if((e as {status?:number}).status&&((e as {status:number}).status<500))attempt.current=undefined;}
  finally{working.current=false;setBusy(false)}
 }
 return <Modal label="Export appliances" onClose={()=>{if(!working.current)onClose()}} className="compact-modal">
  <header className="modal-head"><div><span className="eyebrow">DESKTOP EXPORT</span><h2>{finished?'Export files prepared':'Review '+selection.length+' appliance'+(selection.length===1?'':'s')}</h2></div><button className="icon-button" disabled={busy} onClick={onClose} aria-label="Close export"><X/></button></header>
  <div className="modal-content">
   {error?<p className="notice error" role="alert">{error}</p>:null}{note?<p className="notice" role="status">{note}</p>:null}
   {finished?<><p role="status">{batchId?'This batch is saved in export history. Its appliances are in Inventory.':'Copies prepared from this device’s saved inventory.'}</p><p>If your browser saved only one file, download the other below.</p><div className="export-files">{files.map(file=><a className="button" href={file.url} download={file.name} key={file.kind}><ArrowDownToLine size={17}/><span>Download {file.kind==='korona'?'KORONA':'inventory'} CSV<small>{file.name}</small></span></a>)}</div><button className="button primary" onClick={onInventory}>View inventory<ChevronRight size={17}/></button></>:<>
    <div className={mixed?'notice error':'notice'}><div><strong>{mixed?'Multiple stores selected':'Store for this export'}</strong>{stores.map(s=><p key={s.code}>{s.name}: {s.count} appliance{s.count===1?'':'s'}</p>)}{stores.reduce((n,s)=>n+s.count,0)!==selection.length?<p>Some items need a current store. Open those items and choose their store.</p>:null}</div></div>
    <details className="export-selection"><summary>Review selected appliances ({selection.length})</summary><ul>{selection.map(r=><li key={r.id}><strong>{[r.brand,r.type].filter(Boolean).join(' ')||'Unidentified appliance'}</strong><br/>{recordLabel(r)} · {r.location||'Store needed'}</li>)}</ul></details>
    {mixed&&!offline?<div className="field"><label htmlFor="overrideReason">Reason for mixed-store override</label><textarea id="overrideReason" value={reason} maxLength={500} onChange={e=>setReason(e.target.value)} placeholder="Why should these stores be exported together?"/><p className="field-hint">Your account, reason and selected stores will be recorded for this export.</p><button className="button" onClick={onClose}>Review selection</button></div>:null}
    {offline?<p className="notice">{canCopyOffline?'Download copies of already processed items. New exports and reversals need a connection.':'Receiving works offline. Connect this desktop before assigning numbers and processing an export.'}</p>:<p className="small muted">The first export assigns each permanent product number. Export history lets you reverse processing if needed.</p>}
    <div className="export-option"><h3>Two files, one export</h3><p>{selection.length} selected in the complete inventory CSV. {ready.length} eligible for the KORONA product CSV.</p><button className="button primary" disabled={busy||!ready.length||offline&&!canCopyOffline||mixed&&!offline&&reason.trim().length<3} onClick={()=>void download('both')}><ArrowDownToLine size={17}/>{busy?'Preparing export…':mixed&&!offline?'Override and export both CSVs':offline?'Download both CSV copies':'Download both CSVs'}</button></div>
    <div className="export-option"><h3>Individual files</h3><div className="button-row"><button className="button" disabled={busy||!ready.length||offline&&!canCopyOffline||mixed&&!offline&&reason.trim().length<3} onClick={()=>void download('korona')}>Download KORONA CSV</button><button className="button" disabled={busy||offline&&!canCopyOffline||mixed&&!offline&&reason.trim().length<3} onClick={()=>void download('inventory')}>Download inventory CSV</button></div><p className="small muted">Drafts can be exported in the inventory file after choosing their type, store, receiving date and fuel where applicable.</p></div>
   </>}
   <div className="notice small">Export prepares files for manual import. KORONA product imports and stock receiving are separate operations. Reversing this app’s export does not undo a completed KORONA import.</div>
  </div>
 </Modal>;
}
