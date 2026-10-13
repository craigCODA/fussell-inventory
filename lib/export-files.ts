import {exportRows,makeCsv} from './domain.mjs';
import type {Appliance} from './types';
export type ExportFile={kind:'inventory'|'korona';name:string;url:string};
export function prepareFiles(records:Appliance[],kind:'inventory'|'korona'|'both',at:string):ExportFile[]{
 const kinds:Array<'inventory'|'korona'>=kind==='both'?['korona','inventory']:[kind];
 return kinds.map(format=>({kind:format,name:'Fussell-'+format+'-'+at.slice(0,19).replace(/:/g,'-')+'.csv',url:URL.createObjectURL(new Blob([makeCsv(exportRows(records,format,location.origin))],{type:'text/csv;charset=utf-8'}))}));
}
export function requestDownloads(files:ExportFile[]){for(const file of files){const a=document.createElement('a');a.href=file.url;a.download=file.name;document.body.appendChild(a);a.click();a.remove()}}
