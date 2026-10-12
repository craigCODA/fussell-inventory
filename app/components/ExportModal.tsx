import {useEffect,useRef,useState} from 'react';
import {ArrowDownToLine,ChevronRight,X} from 'lucide-react';
import {exportRows,makeCsv,readyErrors} from '../../lib/domain.mjs';
import {markRecordsExported,type ExportMark} from '../../lib/local-inventory';
import type {Appliance} from '../../lib/types';
import Modal from './Modal';

type Kind='inventory'|'korona';
type Prepared={files:Array<{kind:Kind;name:string;url:string}>;marks:ExportMark[];at:string;moved:boolean};
const exportable=(r:Appliance)=>({...r,frontKey:r.frontKey||(r.localFront?'local-photo':''),tagKey:r.tagKey||(r.localTag?'local-photo':'')});

export default function ExportModal({records,onProcessed,onClose,onInventory}:{records:Appliance[];onProcessed:(updated:Appliance[])=>void;onClose:()=>void;onInventory:()=>void}){
 // Keep the exported selection visible when its records leave Recieving.
 const [selection]=useState(()=>records);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[prepared,setPrepared]=useState<Prepared>();
 const working=useRef(false),urls=useRef<string[]>([]);
 const ready=selection.filter(r=>r.status==='ready'&&!readyErrors(exportable(r)).length);
 useEffect(()=>()=>{const created=urls.current;setTimeout(()=>created.forEach(url=>URL.revokeObjectURL(url)),60000)},[]);

 async function move(batch:Prepared){
  const updated=await markRecordsExported(batch.marks,batch.at);
  onProcessed(updated);setPrepared({...batch,moved:true});
 }
 async function download(kind:Kind|'both'){
  if(working.current)return;working.current=true;setBusy(true);setError('');
  try{
   if(!selection.length||kind!=='inventory'&&!ready.length)throw Error('Select complete, reviewed ready items for the KORONA export.');
   const at=new Date().toISOString(),kinds:Kind[]=kind==='both'?['korona','inventory']:[kind];
   const files=kinds.map(format=>{
    const rows=exportRows(format==='korona'?ready.map(exportable):selection,format,location.origin);
    const url=URL.createObjectURL(new Blob([makeCsv(rows)],{type:'text/csv;charset=utf-8'}));urls.current.push(url);
    return {kind:format,name:'Fussell-'+format+'-'+at.slice(0,19).replace(/:/g,'-')+'.csv',url};
   });
   const readyIds=new Set(ready.map(r=>r.id));
   const marks:ExportMark[]=(kind==='korona'?ready:selection).map(record=>({record,kinds:kinds.filter(format=>format==='inventory'||readyIds.has(record.id))}));
   const batch:Prepared={files,marks,at,moved:false};
   // Start both downloads during the user's click. Browsers may still restrict
   // multiple downloads, so keep a direct link to each prepared file below.
   for(const file of files){const a=document.createElement('a');a.href=file.url;a.download=file.name;document.body.appendChild(a);a.click();a.remove()}
   setPrepared(batch);await move(batch);
  }catch(e){setError(e instanceof Error?e.message:'Export failed. Please try again.')}
  finally{working.current=false;setBusy(false)}
 }
 async function retryMove(){
  if(!prepared||working.current)return;working.current=true;setBusy(true);setError('');
  try{await move(prepared)}catch(e){setError(e instanceof Error?e.message:'Could not save the processing status. Please try again.')}
  finally{working.current=false;setBusy(false)}
 }
 return <Modal label="Export appliances" onClose={()=>{if(!working.current)onClose()}} className="compact-modal">
  <header className="modal-head"><div><span className="eyebrow">TAKE YOUR RECORDS WITH YOU</span><h2>{prepared?'Export files prepared':'Export '+selection.length+' appliance'+(selection.length===1?'':'s')}</h2></div><button className="icon-button" disabled={busy} onClick={onClose} aria-label="Close export"><X/></button></header>
  <div className="modal-content">
   {error?<p className="notice error" role="alert">{error}</p>:null}
   {prepared?<div className="export-result">
    <p role="status">{busy?'Saving processing status…':prepared.moved?prepared.marks.length+' appliance'+(prepared.marks.length===1?' is':'s are')+' now in Inventory.':'Files are ready, but the move to Inventory has not been saved.'}</p>
    <p>Downloads were requested. If your phone only saved one file, use the links below to save the other.</p>
    <div className="export-files">{prepared.files.map(file=><a className="button" href={file.url} download={file.name} key={file.kind}><ArrowDownToLine size={17}/><span>Download {file.kind==='korona'?'KORONA':'inventory'} CSV<small>{file.name}</small></span></a>)}</div>
    {prepared.moved?<button className="button primary" onClick={onInventory}>View inventory<ChevronRight size={17}/></button>:<button className="button primary" disabled={busy} onClick={()=>void retryMove()}>{busy?'Saving…':'Retry moving to inventory'}</button>}
   </div>:<>
    <div className="export-option"><h3>Export both files</h3><p>{selection.length} selected record{selection.length===1?'':'s'} in the complete inventory CSV. {ready.length} ready record{ready.length===1?'':'s'} eligible. The KORONA CSV includes only these complete, reviewed ready items.</p><button className="button primary" disabled={busy||!ready.length} onClick={()=>void download('both')}><ArrowDownToLine size={17}/>{busy?'Preparing…':'Download both CSVs'}</button><p className="export-hint">Exported items move from Recieving to Inventory. Their status and store location stay the same.</p></div>
    <div className="export-option"><h3>Individual files</h3><p>Use the inventory CSV on its own for drafts or other records that are not ready for KORONA.</p><div className="button-row"><button className="button" disabled={busy||!ready.length} onClick={()=>void download('korona')}><ArrowDownToLine size={17}/>Download KORONA CSV</button><button className="button" disabled={busy||!selection.length} onClick={()=>void download('inventory')}><ArrowDownToLine size={17}/>Download inventory CSV</button></div><p className="export-hint">The complete inventory file includes model, serial, condition and price. Photo links become available after syncing and require access to this app.</p></div>
   </>}
   <div className="notice small">Preparing a CSV does not import it into KORONA. Use Settings → Data Exchange → Custom CSV, map the columns to your account, and confirm the price and commodity groups. This creates or updates products; receiving stock is a separate step.</div>
  </div>
 </Modal>;
}
