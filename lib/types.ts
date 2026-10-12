export type Appliance={
 syncState?:'pending'|'synced'|'error';syncError?:string;localFront?:Blob;localTag?:Blob;
 id:string;inventoryId:string;type:string;brand:string;model:string;serial:string;location:string;bin:string;condition:string;testStatus:string;status:string;price:string;cost:string;notes:string;frontKey:string;tagKey:string;ocrModel:string;ocrSerial:string;ocrText:string;modelReviewed:boolean;serialReviewed:boolean;revision?:number;createdAt?:string;updatedAt?:string;updatedBy?:string;
};
export type IntakeDraft={record:Appliance;front?:Blob;tag?:Blob;step:number;savedAt:string};
export function blankRecord():Appliance{const id=crypto.randomUUID();return {id,inventoryId:'FA-'+id.slice(0,8).toUpperCase(),type:'',brand:'',model:'',serial:'',location:'',bin:'',condition:'',testStatus:'Not tested',status:'draft',price:'',cost:'',notes:'',frontKey:'',tagKey:'',ocrModel:'',ocrSerial:'',ocrText:'',modelReviewed:false,serialReviewed:false};}
export const mediaUrl=(key:string)=>'/api/media?key='+encodeURIComponent(key);
async function responseJson(r:Response){
 if(!r.headers.get('content-type')?.includes('application/json'))throw Object.assign(Error(r.status>=500?'The server is temporarily unavailable. Syncing will retry.':'Your sign-in needs to be refreshed. Reopen this page; saved items stay on this device.'),{status:r.status>=500?r.status:401});
 const data=await r.json();if(!r.ok)throw Object.assign(Error(data.error||'Request failed'),{status:r.status});return data;
}
export async function api<T=unknown>(path:string,body?:unknown){const r=await fetch('/api/'+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(25000)}:{signal:AbortSignal.timeout(25000)});return await responseJson(r) as T;}
export async function upload(file:Blob,kind:'photo'|'prompt'){const form=new FormData();form.set('kind',kind);form.set('file',file,kind==='photo'?'photo.jpg':'instruction');const r=await fetch('/api/upload',{method:'POST',body:form,signal:AbortSignal.timeout(60000)});return (await responseJson(r)).key as string;}
