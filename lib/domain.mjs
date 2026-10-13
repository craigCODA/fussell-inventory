import {STORES,validDate,currentStore,numberingDetails} from './numbering.mjs';
export const TYPES=['Washer','Dryer','Refrigerator','Range','Oven','Dishwasher','Freezer','Microwave','Other'];
export const STATUSES=['draft','ready','reserved','sold','archived'];
export const TESTS=['Not tested','Passed','Needs repair','Failed'];
export const PROMPTS=[
 {key:'front',title:'Appliance photo',text:'Take a full photo of the appliance. Rotate or retake it, then tap Use photo.'},
 {key:'tag',title:'Identification tag',text:'Take a close photo of the model and serial label. Make sure every character is clear. Rotate it upright, then tap Use photo.'},
 {key:'serial',title:'Serial number',text:'Read the serial number one character at a time. Say zero for the number, or letter O. You can also type it.'},
 {key:'model',title:'Model number',text:'Read the model number, including any slash, dash, or suffix. If the label is missing, you can leave this as a draft.'},
 {key:'condition',title:'Condition',text:'Describe the condition and any damage.'},
 {key:'testStatus',title:'Testing',text:'Has the appliance passed testing, failed, or does it need repair? Choose a test status.'},
 {key:'location',title:'Location',text:'Say the store or warehouse and the row or bin.'},
 {key:'price',title:'Selling price',text:'Enter or say the selling price. Check the amount before saving.'},
 {key:'review',title:'Final review',text:'Check the photos and details. Resolve any differences with the tag, then confirm and save the record.'}
];
export function normalizeIdentifier(v){return String(v||'').trim().toUpperCase().replace(/\s+/g,'');}
const spelling={zero:'0',one:'1',two:'2',three:'3',four:'4',five:'5',six:'6',seven:'7',eight:'8',nine:'9',oh:'O',alpha:'A',alfa:'A',bravo:'B',charlie:'C',delta:'D',echo:'E',foxtrot:'F',golf:'G',hotel:'H',india:'I',juliet:'J',juliett:'J',kilo:'K',lima:'L',mike:'M',november:'N',oscar:'O',papa:'P',quebec:'Q',romeo:'R',sierra:'S',tango:'T',uniform:'U',victor:'V',whiskey:'W',whisky:'W','x-ray':'X',yankee:'Y',zulu:'Z',slash:'/',dash:'-',hyphen:'-',dot:'.'};
export function spokenIdentifier(v){
 const text=String(v||'').toLowerCase().replace(/\b([a-z])\s+as\s+in\s+[a-z]+\b/g,'$1').replace(/\bletter\s+/g,'').replace(/\bforward\s+slash\b/g,'slash').replace(/[,;]/g,' ');
 return text.split(/\s+/).filter(Boolean).map(t=>spelling[t]??t.toUpperCase()).join('');
}
export function compareIdentifiers(entered,photo){
 const a=normalizeIdentifier(entered),b=normalizeIdentifier(photo);
 if(!a||!b)return {status:'unread',positions:[]};
 const positions=[];for(let i=0;i<Math.max(a.length,b.length);i++)if(a[i]!==b[i])positions.push(i+1);
 return {status:positions.length?'mismatch':'match',positions};
}
export function extractTag(raw){
 const t=String(raw||'').toUpperCase();
 const get=(pattern)=>{const match=t.match(pattern);return match?match[1].trim().replace(/[.,:;]+$/,''):''};
 const model=get(/\b(?:MODEL|MOD\.?|M\/N)\s*(?:NO\.?|NUMBER|#)?\s*[:.\-]?\s*([A-Z0-9][A-Z0-9./_-]{3,})/);
 const serial=get(/\b(?:SERIAL|SER\.?|S\/N)\s*(?:NO\.?|NUMBER|#)?\s*[:.\-]?\s*([A-Z0-9][A-Z0-9./_-]{3,})/);
 const brands=['Samsung','Whirlpool','Frigidaire','Maytag','Kenmore','Bosch','Electrolux','Amana','KitchenAid','Hotpoint','Haier','GE','LG'];
 const brand=brands.find(b=>new RegExp('\\b'+b+'\\b','i').test(t))||'';
 const type=TYPES.find(x=>x!=='Other'&&new RegExp('\\b'+x+'\\b','i').test(t))||'';
 return {brand,type,model,serial};
}
export function parseMoney(value){
 let s=String(value??'').trim();if(!s)return null;
 s=s.replace(/^\$/,'');
 if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(s))throw Error('Enter a valid price, such as 399.95.');
 const [whole,fraction='']=s.replace(/,/g,'').split('.');const cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 if(!Number.isSafeInteger(cents)||cents>100000000)throw Error('Price is too large.');return cents;
}
export function readyErrors(r){
 const errors=[];
 if(r.inventoryId?.startsWith('TMP-')){
  if(!currentStore(r))errors.push('Choose the current store.');
  try{numberingDetails(r)}catch(e){errors.push(e.message)}
 }
 for(const [key,label] of [['type','appliance type'],['brand','brand'],['model','model number'],['serial','serial number'],['location','location'],['condition','condition'],['testStatus','test status'],['frontKey','appliance photo'],['tagKey','tag photo']])if(!String(r[key]||'').trim())errors.push('Add '+label+'.');
 try{if(parseMoney(r.price)===null)errors.push('Set a selling price.');}catch(e){errors.push(e.message);}
 for(const field of ['model','serial'])if(compareIdentifiers(r[field],r['ocr'+field[0].toUpperCase()+field.slice(1)]).status!=='match'&&!r[field+'Reviewed'])errors.push('Confirm the '+field+' against the tag.');
 return errors;
}
export function validateRecord(input){
 const r={};
 const strings=['id','inventoryId','type','brand','model','serial','location','bin','condition','testStatus','status','price','cost','notes','frontKey','tagKey','ocrModel','ocrSerial','ocrText'];
 for(const k of strings){const v=input[k]??'';if(typeof v!=='string')throw Error('Invalid '+k);if(v.length>(['notes','ocrText'].includes(k)?12000:300))throw Error(k+' is too long.');r[k]=v.trim();}
 if(!/^[a-f\d-]{36}$/i.test(r.id))throw Error('Invalid record identifier.');
 r.inventoryId=r.inventoryId.toUpperCase();if(!/^[A-Z0-9][A-Z0-9-]{2,39}$/.test(r.inventoryId))throw Error('Use an inventory ID with letters, numbers and hyphens.');
 r.model=normalizeIdentifier(r.model);r.serial=normalizeIdentifier(r.serial);
 if(!STATUSES.includes(r.status))throw Error('Choose a valid inventory status.');
 if(r.type&&!TYPES.includes(r.type))throw Error('Choose a valid appliance type.');
 for(const key of ['storeCode','receivingStore','receivedDate','fuel']){
  if(input[key]!==undefined){if(typeof input[key]!=='string')throw Error('Invalid '+key);r[key]=input[key].trim();}
 }
 for(const key of ['storeCode','receivingStore'])if(r[key]&&!STORES.some(s=>s.code===r[key]))throw Error('Choose a valid store.');
 if(r.receivedDate&&!validDate(r.receivedDate))throw Error('Choose a valid receiving date.');
 if(r.fuel&&!['Electric','Gas'].includes(r.fuel))throw Error('Choose electric or gas fuel.');
 r.modelReviewed=input.modelReviewed===true;r.serialReviewed=input.serialReviewed===true;
 if(input.exportedAt!==undefined){
  if(typeof input.exportedAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(input.exportedAt)||!Number.isFinite(Date.parse(input.exportedAt)))throw Error('Invalid export date.');
  if(!Array.isArray(input.exportKinds)||!input.exportKinds.length||input.exportKinds.some(k=>!['inventory','korona'].includes(k)))throw Error('Invalid export formats.');
  r.exportedAt=input.exportedAt;r.exportKinds=['inventory','korona'].filter(k=>input.exportKinds.includes(k));
 }
 parseMoney(r.price);parseMoney(r.cost);
 if(r.status==='ready'){const errors=readyErrors(r);if(errors.length)throw Error(errors.join(' '));}
 return r;
}
export function makeCsv(rows){
 const cell=v=>{let s=String(v??'');if(/^[\s]*[=+\-@]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"'};
 return '\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n')+'\r\n';
}
export function exportRows(records,kind,origin){
 if(kind==='korona')return [['Product - Product Number','Product - Product Name','Commodity Group - Commodity Group Name','Product - Product Retail Price','Product - Product Track Inventory'],...records.filter(r=>r.status==='ready'&&readyErrors(r).length===0).map(r=>[r.inventoryId,[r.brand,r.type,r.model,r.inventoryId].filter(Boolean).join(' '),r.type,(parseMoney(r.price)/100).toFixed(2),'1'])];
 const cols=['inventoryId','type','brand','model','serial','condition','testStatus','status','location','bin','price','cost','notes'];
 const extra=['fuel','storeCode','receivingStore','receivedDate','exportBatchId'];
 return [[...cols,'appliancePhoto','tagPhoto','updatedAt',...extra],...records.map(r=>[...cols.map(k=>r[k]??''),r.frontKey?origin+'/api/media?key='+encodeURIComponent(r.frontKey):'',r.tagKey?origin+'/api/media?key='+encodeURIComponent(r.tagKey):'',r.updatedAt||'',...extra.map(k=>r[k]??'')])];
}
export function spokenCharacters(value){return normalizeIdentifier(value).split('').map(c=>c==='0'?'zero':c==='O'?'letter O':c==='I'?'letter I':c==='1'?'one':c==='/'?'slash':c==='-'?'dash':c).join(', ');}
