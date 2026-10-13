import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {handleApi} from '../../lib/service.mjs';
import {env} from '../helpers/storage.mjs';

let browser,server,origin;
const user={userId:'browser-test',email:'operator@example.com'};
before(async()=>{server=await createServer({server:{host:'127.0.0.1',port:0}});await server.listen();origin=server.resolvedUrls.local[0];browser=await chromium.launch({headless:true,args:['--no-sandbox']})});
after(async()=>{await browser?.close();await server?.close()});
async function fixture(t,width,operator=true){
 const e=env(),identity=operator?user:{userId:'staff',email:'staff@example.com'};
 const save=async r=>{const res=await handleApi(new Request(origin+'api/records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeCode:'BA',receivingStore:'BA',receivedDate:'2026-10-12',...r})}),e,user);assert.equal(res.status,200);return res.json()};
 const form=new FormData();form.set('kind','photo');form.set('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==','base64')],{type:'image/png'}),'photo.png');
 const photo=await (await handleApi(new Request(origin+'api/upload',{method:'POST',body:form}),e,user)).json();
 const draft=await save({id:crypto.randomUUID(),inventoryId:'FA-OLD',brand:'Test',type:'Other',status:'draft'});
 const ready=await save({id:crypto.randomUUID(),inventoryId:'FA-READY',brand:'Phone',type:'Other',status:'ready',model:'3842-13-1086',serial:'WZP202906KL',condition:'Good',testStatus:'Passed',location:'Ball · K&T Appliances',price:'25',frontKey:photo.key,tagKey:photo.key,modelReviewed:true,serialReviewed:true});
 const context=await browser.newContext({viewport:{width,height:900}});t.after(()=>context.close());
 await context.route('**/api/**',async route=>{const req=route.request();const res=await handleApi(new Request(req.url(),{method:req.method(),headers:await req.allHeaders(),body:req.postDataBuffer()||undefined}),e,identity);await route.fulfill({status:res.status,headers:Object.fromEntries(res.headers),body:Buffer.from(await res.arrayBuffer())})});
 const page=await context.newPage();page.setDefaultTimeout(6000);await page.goto(origin);await page.getByRole('checkbox',{name:'Select FA-OLD',exact:true}).filter({visible:true}).waitFor();
 const open=id=>width<640?page.locator('.mobile-record').filter({hasText:id}).getByRole('button').click():page.getByRole('button',{name:'Open '+id,exact:true}).click();
 return {page,e,draft,ready,open,save,context};
}

test('delete requires confirmation, removes an archived record and clears the device draft',async t=>{
 const {page,open,e,draft}=await fixture(t,390);
 await open('FA-OLD');await page.getByLabel('Inventory status',{exact:true}).selectOption('archived');await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await page.getByRole('dialog',{name:'Edit appliance',exact:true}).waitFor({state:'hidden'});
 await page.getByLabel('All status filters').selectOption('archived');await open('FA-OLD');
 await page.getByRole('button',{name:'Delete appliance',exact:true}).click();
 await page.getByRole('button',{name:'Keep appliance',exact:true}).click();
 assert.ok(await e.DB.prepare('SELECT * FROM appliances WHERE id=?').bind(draft.id).first());
 await page.getByRole('button',{name:'Delete appliance',exact:true}).click();await page.getByRole('button',{name:'Delete permanently',exact:true}).click();
 await page.getByRole('dialog',{name:'Edit appliance',exact:true}).waitFor({state:'hidden'});
 assert.equal(await e.DB.prepare('SELECT * FROM appliances WHERE id=?').bind(draft.id).first(),null);
 await page.reload();await page.getByRole('tab',{name:'Recieving',exact:true}).waitFor();
 assert.equal(await page.getByText('Pick up where you left off.',{exact:true}).count(),0);
});

for(const response of [{status:403,body:{error:'Deletion denied. Nothing was changed.'}},{status:200,body:{deleted:false}}])test(`unconfirmed deletion (${response.status}) preserves the record, draft edits and local copy`,async t=>{
 const {page,open,e,draft}=await fixture(t,390);let sent;
 await page.route('**/api/records/delete',async route=>{sent=route.request().postDataJSON();await route.fulfill({status:response.status,contentType:'application/json',body:JSON.stringify(response.body)})});
 await open('FA-OLD');await page.getByLabel('Inventory ID',{exact:true}).fill('FA-EDIT-KEPT');
 await page.getByRole('button',{name:'Delete appliance',exact:true}).click();await page.getByRole('button',{name:'Delete permanently',exact:true}).click();
 await page.getByRole('alert').waitFor();
 assert.equal(sent.target,'app');
 assert.equal(await page.getByRole('dialog',{name:'Edit appliance',exact:true}).isVisible(),true);
 assert.equal(await page.getByLabel('Inventory ID',{exact:true}).inputValue(),'FA-EDIT-KEPT');
 assert.ok(await e.DB.prepare('SELECT * FROM appliances WHERE id=?').bind(draft.id).first());
 await page.getByText('Draft saved on this device',{exact:true}).waitFor();
 const local=await page.evaluate(id=>new Promise((resolve,reject)=>{const request=indexedDB.open('fussell-inventory');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('records'),get=tx.objectStore('records').get(id);tx.oncomplete=()=>{resolve(get.result);db.close()}}}),draft.id);
 assert.equal(local.record.id,draft.id);
 await page.reload();await page.getByRole('button',{name:/Continue draft/}).click();
 assert.equal(await page.getByLabel('Inventory ID',{exact:true}).inputValue(),'FA-EDIT-KEPT');
});

const stored=async(e,id)=>{const row=await e.DB.prepare('SELECT * FROM appliances WHERE id=?').bind(id).first();return {...JSON.parse(row.payload),revision:row.revision}};
async function exportReady(page){await page.getByText('All items synced',{exact:true}).waitFor();await page.getByRole('checkbox',{name:'Select FA-READY',exact:true}).filter({visible:true}).check();await page.getByRole('button',{name:'Export (1)',exact:true}).click();await page.getByRole('button',{name:'Download both CSVs',exact:true}).click();await page.getByRole('button',{name:'View inventory',exact:true}).waitFor()}
for(const width of [390,1280])test(`archiving clears selection and desktop permissions are reflected at ${width}px`,async t=>{
 const {page,open}=await fixture(t,width);
 await page.getByRole('checkbox',{name:'Select FA-OLD',exact:true}).filter({visible:true}).check();await open('FA-OLD');await page.getByLabel('Inventory status',{exact:true}).selectOption('archived');await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.getByRole('dialog',{name:'Edit appliance',exact:true}).waitFor({state:'hidden'});
 assert.equal(await page.getByText('1 selected',{exact:true}).count(),0);
 if(width<1024){assert.equal(await page.getByRole('button',{name:/^Export/}).count(),0);await page.getByText('Exports are handled on the desktop.',{exact:true}).waitFor()}
 else assert.equal(await page.getByRole('button',{name:'Export',exact:true}).isDisabled(),true);
});
test('a receiving account on a desktop cannot see export or reversal controls',async t=>{
 const {page}=await fixture(t,1280,false);await page.getByText('Export is limited to the designated operator.',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:/Export|Reverse selected/}).count(),0);
});
test('paired desktop export assigns one permanent number, downloads both files and persists Inventory',async t=>{
 const {page,ready,e}=await fixture(t,1280),downloads=[];page.on('download',d=>downloads.push(d));await exportReady(page);assert.equal(downloads.length,2);
 const saved=await stored(e,ready.id);assert.equal(saved.inventoryId,'FA-OTBA20261012001');assert.equal(saved.status,'ready');assert.equal(saved.location,ready.location);
 for(const d of downloads){const csv=await fs.readFile(await d.path(),'utf8');assert.ok(csv.includes(saved.inventoryId));assert.ok(!csv.includes('FA-READY'));assert.ok(!csv.includes('FA-OLD'))}
 await page.getByRole('button',{name:'View inventory',exact:true}).click();await page.getByRole('checkbox',{name:'Select '+saved.inventoryId,exact:true}).filter({visible:true}).waitFor();
 await page.reload();await page.getByRole('tab',{name:'Inventory',exact:true}).click();await page.getByRole('checkbox',{name:'Select '+saved.inventoryId,exact:true}).filter({visible:true}).waitFor();await page.getByRole('button',{name:'Open '+saved.inventoryId,exact:true}).click();assert.equal(await page.getByRole('button',{name:'Delete appliance',exact:true}).count(),0);
});
test('drafts go only into inventory CSV while the paired batch shares stable numbering',async t=>{
 const {page,e,draft,ready}=await fixture(t,1280);await page.getByText('All items synced',{exact:true}).waitFor();for(const id of ['FA-OLD','FA-READY'])await page.getByRole('checkbox',{name:'Select '+id,exact:true}).filter({visible:true}).check();await page.getByRole('button',{name:'Export (2)',exact:true}).click();const downloads=[];page.on('download',d=>downloads.push(d));await page.getByRole('button',{name:'Download both CSVs',exact:true}).click();await page.getByRole('button',{name:'View inventory',exact:true}).waitFor();
 const a=await stored(e,draft.id),b=await stored(e,ready.id);assert.equal(a.status,'draft');assert.deepEqual(a.exportKinds,['inventory']);assert.deepEqual(b.exportKinds,['inventory','korona']);assert.equal(downloads.length,2);
 for(const download of downloads){const csv=await fs.readFile(await download.path(),'utf8');assert.ok(csv.includes(b.inventoryId));assert.equal(csv.includes(a.inventoryId),download.suggestedFilename().includes('inventory'))}
});
test('mixed-store selection requires an override reason and writes it into export history',async t=>{
 const {page,e,draft,save}=await fixture(t,1280);await save({...draft,storeCode:'AL',receivingStore:'AL',location:'Alexandria · Fussell Appliances'});await page.reload();await page.getByText('All items synced',{exact:true}).waitFor();for(const id of ['FA-OLD','FA-READY'])await page.getByRole('checkbox',{name:'Select '+id,exact:true}).filter({visible:true}).check();await page.getByRole('button',{name:'Export (2)',exact:true}).click();await page.getByText('Multiple stores selected',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Override and export both CSVs',exact:true}).isDisabled(),true);await page.getByLabel('Reason for mixed-store override').fill('Both stores reviewed for pickup');await page.getByRole('button',{name:'Override and export both CSVs',exact:true}).click();await page.getByRole('button',{name:'View inventory',exact:true}).click();await page.getByRole('button',{name:'Export history',exact:true}).click();await page.getByText('Both stores reviewed for pickup',{exact:false}).waitFor();
 const events=(await e.DB.prepare("SELECT value FROM settings WHERE key LIKE 'inventory-export:%'").all()).results;assert.equal(events.length,1);assert.equal(JSON.parse(events[0].value).overrideReason,'Both stores reviewed for pickup');
 await page.screenshot({path:'/tmp/fussell-export-history.png',fullPage:true});
});
test('selected-item reversal returns to Receiving, preserves IDs, survives reload and has no delete option',async t=>{
 const {page,e,ready}=await fixture(t,1280);await exportReady(page);await page.getByRole('button',{name:'View inventory',exact:true}).click();const original=await stored(e,ready.id);
 await page.getByRole('checkbox',{name:'Select '+original.inventoryId,exact:true}).filter({visible:true}).check();await page.getByRole('button',{name:'Reverse selected',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Confirm reversal',exact:true}).isDisabled(),true);await page.getByLabel('Reason for reversal').fill('Wrong appliance selected');await page.getByRole('button',{name:'Confirm reversal',exact:true}).click();await page.getByText('1 appliance(s) returned to Recieving.',{exact:false}).waitFor();await page.getByRole('button',{name:'Close export history',exact:true}).click();
 const cached=await page.evaluate(id=>new Promise((resolve,reject)=>{const request=indexedDB.open('fussell-inventory');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('exports'),get=tx.objectStore('exports').get(id);tx.oncomplete=()=>{resolve(get.result);db.close()}}}),original.exportBatchId);assert.deepEqual(cached.reversedIds,[ready.id]);assert.equal(cached.records[0].inventoryId,original.inventoryId);
 const reversed=await stored(e,ready.id);assert.equal(reversed.exportedAt,undefined);assert.equal(reversed.inventoryId,original.inventoryId);await page.getByRole('tab',{name:'Recieving',exact:true}).click();await page.getByRole('button',{name:'Open '+original.inventoryId,exact:true}).click();assert.equal(await page.getByRole('button',{name:'Delete appliance',exact:true}).count(),0);await page.getByRole('button',{name:'Close and keep draft',exact:true}).click();await page.reload();await page.getByRole('checkbox',{name:'Select '+original.inventoryId,exact:true}).filter({visible:true}).waitFor();
});
test('a lost export response retries the same batch and never assigns a second number',async t=>{
 const {page,e,ready}=await fixture(t,1280);let dropped=false;await page.route('**/api/exports',async route=>{const req=route.request();if(req.method()!=='POST'){await route.fallback();return}const result=await handleApi(new Request(req.url(),{method:'POST',headers:await req.allHeaders(),body:req.postDataBuffer()}),e,user);if(!dropped){dropped=true;await route.abort('failed');return}await route.fulfill({status:result.status,contentType:'application/json',body:await result.text()})});
 await page.getByText('All items synced',{exact:true}).waitFor();await page.getByRole('checkbox',{name:'Select FA-READY',exact:true}).filter({visible:true}).check();await page.getByRole('button',{name:'Export (1)',exact:true}).click();await page.getByRole('button',{name:'Download both CSVs',exact:true}).click();await page.getByRole('alert').waitFor();const assigned=(await stored(e,ready.id)).inventoryId;
 await page.getByRole('button',{name:'Download both CSVs',exact:true}).click();await page.getByRole('button',{name:'View inventory',exact:true}).waitFor();assert.equal((await stored(e,ready.id)).inventoryId,assigned);assert.equal((await e.DB.prepare("SELECT key FROM settings WHERE key LIKE 'inventory-export:%'").all()).results.length,1);
});
test('local cache failure after server export keeps the confirmed files and reports the cache limitation',async t=>{
 const {page,e}=await fixture(t,1280);await page.route('**/api/exports',async route=>{const req=route.request();if(req.method()!=='POST'){await route.fallback();return}const response=await handleApi(new Request(req.url(),{method:'POST',headers:await req.allHeaders(),body:req.postDataBuffer()}),e,user);await page.evaluate(()=>{window.savedOpen=indexedDB.open.bind(indexedDB);indexedDB.open=(name,...args)=>{if(name==='fussell-inventory')throw new DOMException('Storage full','QuotaExceededError');return window.savedOpen(name,...args)}});await route.fulfill({status:response.status,contentType:'application/json',body:await response.text()})});
 await exportReady(page);await page.getByText('The server saved this export.',{exact:false}).waitFor();assert.equal(await page.getByRole('link',{name:/Download .* CSV/}).count(),2);assert.equal((await e.DB.prepare("SELECT key FROM settings WHERE key LIKE 'inventory-export:%'").all()).results.length,1);await page.evaluate(()=>{indexedDB.open=window.savedOpen});
});
