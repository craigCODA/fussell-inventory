import {validateRecord,normalizeIdentifier,makeCsv,exportRows,PROMPTS} from './domain.mjs';
const json=(v,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store'}});
const unpack=r=>({...JSON.parse(r.payload),revision:r.revision,createdAt:r.created_at,updatedAt:r.updated_at,updatedBy:r.updated_by});
const fail=(message,status=400)=>Object.assign(Error(message),{status});
export async function handleApi(request,env,user){
 if(!user?.userId)return json({error:'Sign in to access inventory.'},401);
 const url=new URL(request.url),route=url.pathname.replace(/^\/api\//,'');
 const db=env.DB,bucket=env.BUCKET;if(!db||!bucket)return json({error:'Inventory storage is not available. Your current entry has been kept on this device.'},503);
 if(request.method!=='GET'&&request.headers.get('origin')&&request.headers.get('origin')!==url.origin)return json({error:'Request origin is not allowed.'},403);
 try{
  if(route==='records'&&request.method==='GET'){
   const rows=await db.prepare('SELECT * FROM appliances ORDER BY updated_at DESC LIMIT 5000').all();return json({records:rows.results.map(unpack)});
  }
  if(route==='records'&&request.method==='POST'){
   if(Number(request.headers.get('content-length'))>100000)throw fail('Record is too large.');
   const input=await request.json(),r=validateRecord(input);
   for(const key of [r.frontKey,r.tagKey].filter(Boolean)){
    const file=await db.prepare('SELECT * FROM media WHERE key=?').bind(key).first();if(!file||!file.mime.startsWith('image/')||!key.startsWith('photos/'))throw fail('A photo upload is missing. Please attach the photo again.');
   }
   const current=await db.prepare('SELECT * FROM appliances WHERE id=?').bind(r.id).first();
   if(!current&&(input.revision!==undefined||await db.prepare("SELECT id FROM audit WHERE record_id=? AND action='deleted' LIMIT 1").bind(r.id).first()))throw fail('This appliance was deleted. Discard this device draft and refresh inventory.',409);
   const payload=JSON.stringify(r),now=new Date().toISOString(),by=user.email||user.userId;
   if(current&&current.payload===payload)return json(unpack(current));
   if(current&&input.revision!==current.revision)throw fail('This appliance was changed elsewhere. Open the saved record again before updating; your current entry remains on this device.',409);
   const serialKey=r.serial?normalizeIdentifier(r.brand)+'|'+normalizeIdentifier(r.serial):null;
   const statement=current?db.prepare('UPDATE appliances SET inventory_id=?,serial_key=?,payload=?,revision=revision+1,updated_at=?,updated_by=? WHERE id=? AND revision=?').bind(r.inventoryId,serialKey,payload,now,by,r.id,current.revision):db.prepare('INSERT INTO appliances (id,inventory_id,serial_key,payload,revision,created_at,updated_at,updated_by) VALUES (?,?,?,?,1,?,?,?)').bind(r.id,r.inventoryId,serialKey,payload,now,now,by);
   const results=await db.batch([statement,db.prepare('INSERT INTO audit(record_id,action,at,by) SELECT ?,?,?,? WHERE changes()>0').bind(r.id,current?'updated':'created',now,by)]);
   if(!results[0].meta.changes)throw fail('Another save completed first. Reopen this appliance and review the changes.',409);
   return json(unpack(await db.prepare('SELECT * FROM appliances WHERE id=?').bind(r.id).first()));
  }
  if(route==='records/delete'&&request.method==='POST'){
   const {id,revision}=await request.json();
   if(typeof id!=='string'||!/^[a-f\d-]{36}$/i.test(id)||!Number.isSafeInteger(revision)||revision<1)throw fail('Invalid record identifier or revision.');
   const current=await db.prepare('SELECT * FROM appliances WHERE id=?').bind(id).first();
   if(!current)throw fail('This appliance has already been deleted. Refresh inventory.',404);
   if(current.revision!==revision)throw fail('This appliance was changed elsewhere. Reopen the saved record before deleting it.',409);
   const record=unpack(current),now=new Date().toISOString();
   const results=await db.batch([
    db.prepare('DELETE FROM appliances WHERE id=? AND revision=?').bind(id,revision),
    db.prepare('INSERT INTO audit(record_id,action,at,by) SELECT ?,?,?,? WHERE changes()>0').bind(id,'deleted',now,user.email||user.userId)
   ]);
   if(!results[0].meta.changes)throw fail('This appliance changed before deletion. Refresh inventory and review it again.',409);
   let photosRetained=false;
   for(const key of new Set([record.frontKey,record.tagKey].filter(k=>k?.startsWith('photos/')))){
    try{
     const shared=await db.prepare("SELECT id FROM appliances WHERE json_extract(payload,'$.frontKey')=? OR json_extract(payload,'$.tagKey')=? LIMIT 1").bind(key,key).first();
     if(shared)continue;
     // Reject future attachments once photo cleanup starts.
     await db.prepare('DELETE FROM media WHERE key=?').bind(key).run();
     await bucket.delete(key);
    }catch{photosRetained=true}
   }
   return json({deleted:true,photosRetained});
  }
  if(route==='upload'&&request.method==='POST'){
   if(Number(request.headers.get('content-length'))>13*1024*1024)throw fail('File must be under 12 MB.');
   const form=await request.formData(),file=form.get('file'),kind=form.get('kind');
   if(!(file instanceof Blob)||!['photo','prompt'].includes(kind)||!file.size||file.size>12*1024*1024)throw fail('Select a valid file under 12 MB.');
   const bytes=new Uint8Array(await file.arrayBuffer());let mime=file.type.split(';')[0];
   if(kind==='photo'){
    const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
    const png=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71;
    const webp=String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
    if(!jpeg&&!png&&!webp)throw fail('Use a JPEG, PNG, or WebP photo.');mime=jpeg?'image/jpeg':png?'image/png':'image/webp';
   }else if(!['audio/mpeg','audio/mp3','audio/mp4','audio/x-m4a','audio/wav','audio/x-wav','audio/webm','audio/ogg','video/mp4'].includes(mime))throw fail('Use an MP3, M4A, WAV, WebM or OGG recording.');
   const key=(kind==='photo'?'photos/':'prompts/')+crypto.randomUUID();
   await bucket.put(key,bytes,{httpMetadata:{contentType:mime}});
   try{await db.prepare('INSERT INTO media(key,mime,size,created_at,created_by) VALUES(?,?,?,?,?)').bind(key,mime,bytes.length,new Date().toISOString(),user.userId).run();}catch(e){await bucket.delete(key);throw e}
   return json({key,url:'/api/media?key='+encodeURIComponent(key)});
  }
  if(route==='media'&&request.method==='GET'){
   const key=url.searchParams.get('key')||'';if(!/^(photos|prompts)\/[a-f\d-]{36}$/i.test(key))throw fail('File not found.',404);
   const file=await db.prepare('SELECT * FROM media WHERE key=?').bind(key).first();if(!file)throw fail('File not found.',404);
   const blob=await bucket.get(key);if(!blob)throw fail('File not found.',404);
   return new Response(blob.body,{headers:{'Content-Type':file.mime,'Content-Length':String(file.size),'Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff','Content-Disposition':'inline'}});
  }
  if(route==='prompts'&&request.method==='GET'){
   const rows=await db.prepare('SELECT * FROM settings').all();return json(Object.fromEntries(rows.results.map(r=>[r.key,JSON.parse(r.value)])));
  }
  if(route==='prompts'&&request.method==='POST'){
   const {prompt,key}=await request.json();if(!PROMPTS.some(p=>p.key===prompt))throw fail('Unknown instruction.');
   if(key){const f=await db.prepare('SELECT * FROM media WHERE key=?').bind(key).first();if(!f||!key.startsWith('prompts/'))throw fail('Instruction recording is missing.');}
   await db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(prompt,JSON.stringify(key||'')).run();return json({saved:true});
  }
  if(route==='history'&&request.method==='GET'){
   const rows=await db.prepare('SELECT action,at,by FROM audit WHERE record_id=? ORDER BY id DESC LIMIT 50').bind(url.searchParams.get('id')||'').all();return json(rows.results);
  }
  if(route==='export'&&request.method==='GET'){
   const kind=url.searchParams.get('kind')==='korona'?'korona':'inventory';const ids=(url.searchParams.get('ids')||'').split(',').filter(Boolean);
   if(!ids.length)throw fail('Select appliances to export.');
   const rows=await db.prepare('SELECT * FROM appliances ORDER BY inventory_id').all();const selected=rows.results.map(unpack).filter(r=>ids.includes(r.id));
   const output=exportRows(selected,kind,url.origin);if(output.length<2)throw fail(kind==='korona'?'Select ready appliances with complete, reviewed details and a price.':'No matching appliances.');
   return new Response(makeCsv(output),{headers:{'Content-Type':'text/csv;charset=utf-8','Content-Disposition':'attachment; filename="Fussell-'+kind+'-'+new Date().toISOString().slice(0,10)+'.csv"','Cache-Control':'no-store'}});
  }
  return json({error:'Not found.'},404);
 }catch(e){if(/UNIQUE constraint failed/.test(e.message))return json({error:'That inventory ID or brand/serial combination already exists. Find the existing appliance before creating another record.'},409);return json({error:e.status||e instanceof SyntaxError||e.message?.startsWith('Invalid')||e.message?.startsWith('Add')||e.message?.startsWith('Choose')||e.message?.startsWith('Use')||e.message?.startsWith('Enter')||e.message?.startsWith('Confirm')||e.message?.startsWith('Set')||e.message?.startsWith('Price')?e.message:'The request could not be saved. Please try again; your current entry is preserved.'},e.status||400);}
}
