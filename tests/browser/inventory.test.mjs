import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {handleApi} from '../../lib/service.mjs';
import {env} from '../helpers/storage.mjs';

let browser,server,origin;
const user={userId:'browser-test'};
before(async()=>{server=await createServer({server:{host:'127.0.0.1',port:0}});await server.listen();origin=server.resolvedUrls.local[0];browser=await chromium.launch({headless:true,args:['--no-sandbox']})});
after(async()=>{await browser?.close();await server?.close()});
async function fixture(t,width){
 const e=env();
 const save=async r=>{const res=await handleApi(new Request(origin+'api/records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(r)}),e,user);assert.equal(res.status,200);return res.json()};
 const form=new FormData();form.set('kind','photo');form.set('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==','base64')],{type:'image/png'}),'photo.png');
 const photo=await (await handleApi(new Request(origin+'api/upload',{method:'POST',body:form}),e,user)).json();
 const draft=await save({id:crypto.randomUUID(),inventoryId:'FA-OLD',brand:'Test',type:'Other',status:'draft'});
 const ready=await save({id:crypto.randomUUID(),inventoryId:'FA-READY',brand:'Phone',type:'Other',status:'ready',model:'3842-13-1086',serial:'WZP202906KL',condition:'Good',testStatus:'Passed',location:'Store',price:'25',frontKey:photo.key,tagKey:photo.key,modelReviewed:true,serialReviewed:true});
 const context=await browser.newContext({viewport:{width,height:900}});t.after(()=>context.close());
 await context.route('**/api/**',async route=>{const req=route.request();const res=await handleApi(new Request(req.url(),{method:req.method(),headers:await req.allHeaders(),body:req.postDataBuffer()||undefined}),e,user);await route.fulfill({status:res.status,headers:Object.fromEntries(res.headers),body:Buffer.from(await res.arrayBuffer())})});
 const page=await context.newPage();page.setDefaultTimeout(6000);await page.goto(origin);await page.getByRole('checkbox',{name:'Select FA-OLD',exact:true}).filter({visible:true}).waitFor();
 const open=id=>width<640?page.locator('.mobile-record').filter({hasText:id}).getByRole('button').click():page.getByRole('button',{name:'Open '+id,exact:true}).click();
 return {page,e,draft,ready,open,save};
}

for(const width of [390,1280])test(`archiving a selected item clears it and exports only the checked ready item at ${width}px`,async t=>{
 const {page,open,ready}=await fixture(t,width);
 await page.getByRole('checkbox',{name:'Select FA-OLD',exact:true}).filter({visible:true}).check();
 await open('FA-OLD');await page.getByLabel('Inventory status',{exact:true}).selectOption('archived');await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await page.getByRole('dialog',{name:'Edit appliance',exact:true}).waitFor({state:'hidden'});
 assert.equal(await page.getByRole('button',{name:/^Export/}).isDisabled(),true,'archived item must not remain selected');
 await page.getByRole('checkbox',{name:'Select FA-READY',exact:true}).filter({visible:true}).check();
 await page.getByRole('button',{name:'Export (1)',exact:true}).click();
 await page.getByText('1 ready record eligible.',{exact:false}).waitFor();
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Download KORONA CSV',exact:true}).click();const download=await downloadPromise;
 const csv=await fs.readFile(await download.path(),'utf8');assert.ok(csv.includes(ready.inventoryId));assert.ok(csv.includes('25.00'));assert.ok(!csv.includes('FA-OLD'));
});

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
 await page.reload();await page.getByRole('button',{name:'Export',exact:true}).waitFor();
 assert.equal(await page.getByText('Pick up where you left off.',{exact:true}).count(),0);
});

for(const width of [390,1280])test(`paired export moves only exported appliances from Recieving to Inventory at ${width}px`,async t=>{
 const {page,ready,e}=await fixture(t,width);
 assert.equal(await page.getByRole('button',{name:'All appliances',exact:true}).count(),0);
 await page.getByRole('tab',{name:'Recieving',exact:true}).waitFor();
 await page.getByRole('checkbox',{name:'Select FA-READY',exact:true}).filter({visible:true}).check();
 await page.getByRole('button',{name:'Export (1)',exact:true}).click();
 const downloads=[];const both=new Promise(resolve=>page.on('download',d=>{downloads.push(d);if(downloads.length===2)resolve()}));
 await page.getByRole('button',{name:'Download both CSVs',exact:true}).click();
 await Promise.race([both,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Both CSV downloads were not received')),6000);timer.unref()})]);
 assert.deepEqual(downloads.map(d=>d.suggestedFilename().includes('korona')?'korona':'inventory').sort(),['inventory','korona']);
 for(const d of downloads){const csv=await fs.readFile(await d.path(),'utf8');assert.ok(csv.includes(ready.inventoryId));assert.ok(!csv.includes('FA-OLD'))}
 await page.getByRole('button',{name:'View inventory',exact:true}).click();
 await page.getByRole('heading',{name:'Inventory',exact:true}).waitFor();
 await page.getByRole('checkbox',{name:'Select FA-READY',exact:true}).filter({visible:true}).waitFor();
 assert.equal(await page.getByRole('checkbox',{name:'Select FA-OLD',exact:true}).filter({visible:true}).count(),0);
 await page.getByText('All items synced',{exact:true}).waitFor();
 const saved=JSON.parse((await e.DB.prepare('SELECT payload FROM appliances WHERE id=?').bind(ready.id).first()).payload);assert.ok(saved.exportedAt);assert.equal(saved.status,'ready');assert.equal(saved.location,ready.location);
 await page.reload();await page.getByRole('tab',{name:'Inventory',exact:true}).click();await page.getByRole('checkbox',{name:'Select FA-READY',exact:true}).filter({visible:true}).waitFor();
 await page.getByRole('tab',{name:'Recieving',exact:true}).click();await page.getByRole('checkbox',{name:'Select FA-OLD',exact:true}).filter({visible:true}).waitFor();
 assert.equal(await page.getByRole('checkbox',{name:'Select FA-READY',exact:true}).filter({visible:true}).count(),0);
});

test('paired export includes drafts only in the inventory file and preserves each record status',async t=>{
 const {page,e,draft,ready}=await fixture(t,390);
 for(const id of ['FA-OLD','FA-READY'])await page.getByRole('checkbox',{name:'Select '+id,exact:true}).filter({visible:true}).check();
 await page.getByRole('button',{name:'Export (2)',exact:true}).click();
 const downloads=[];page.on('download',d=>downloads.push(d));
 await page.getByRole('button',{name:'Download both CSVs',exact:true}).click();
 await page.getByRole('button',{name:'View inventory',exact:true}).click();
 assert.equal(downloads.length,2);
 for(const download of downloads){const csv=await fs.readFile(await download.path(),'utf8');assert.ok(csv.includes(ready.inventoryId));assert.equal(csv.includes(draft.inventoryId),download.suggestedFilename().includes('inventory'))}
 for(const id of ['FA-OLD','FA-READY'])await page.getByRole('checkbox',{name:'Select '+id,exact:true}).filter({visible:true}).waitFor();
 await page.getByText('All items synced',{exact:true}).waitFor();
 const savedDraft=JSON.parse((await e.DB.prepare('SELECT payload FROM appliances WHERE id=?').bind(draft.id).first()).payload);
 assert.equal(savedDraft.status,'draft');assert.deepEqual(savedDraft.exportKinds,['inventory']);assert.ok(savedDraft.exportedAt);
 await page.getByRole('tab',{name:'Recieving',exact:true}).click();assert.equal(await page.locator('.mobile-record').count(),0);
});

test('export tracking failure keeps files available and offers a retry without claiming the move succeeded',async t=>{
 const {page}=await fixture(t,390);
 await page.getByText('All items synced',{exact:true}).waitFor();
 await page.getByRole('checkbox',{name:'Select FA-READY',exact:true}).filter({visible:true}).check();
 await page.getByRole('button',{name:'Export (1)',exact:true}).click();
 await page.evaluate(()=>{window.originalOpen=indexedDB.open.bind(indexedDB);indexedDB.open=(name,...args)=>{if(name==='fussell-inventory')throw new DOMException('Storage full','QuotaExceededError');return window.originalOpen(name,...args)}});
 await page.getByRole('button',{name:'Download both CSVs',exact:true}).click();
 await page.getByText('Files are ready, but the move to Inventory has not been saved.',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'View inventory',exact:true}).count(),0);
 assert.equal(await page.getByRole('link',{name:/Download .* CSV/}).count(),2);
 await page.evaluate(()=>{indexedDB.open=window.originalOpen});
 await page.getByRole('button',{name:'Retry moving to inventory',exact:true}).click();await page.getByRole('button',{name:'View inventory',exact:true}).click();
 await page.getByRole('checkbox',{name:'Select FA-READY',exact:true}).filter({visible:true}).waitFor();
});

for(const width of [390,1280])test(`processed Inventory has no delete option at ${width}px`,async t=>{
 const {page,ready,save,open}=await fixture(t,width);
 await save({...ready,exportedAt:'2026-10-12T15:00:00.000Z',exportKinds:['inventory','korona']});
 await page.reload();await page.getByRole('tab',{name:'Inventory',exact:true}).click();
 await page.getByRole('checkbox',{name:'Select FA-READY',exact:true}).filter({visible:true}).waitFor();
 await open('FA-READY');
 assert.equal(await page.getByRole('button',{name:/Delete/}).count(),0);
 assert.ok((await page.getByLabel('Inventory status',{exact:true}).locator('option').allTextContents()).includes('Archived'));
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
 const local=await page.evaluate(id=>new Promise((resolve,reject)=>{const request=indexedDB.open('fussell-inventory',1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('records'),get=tx.objectStore('records').get(id);tx.oncomplete=()=>{resolve(get.result);db.close()}}}),draft.id);
 assert.equal(local.record.id,draft.id);
 await page.reload();await page.getByRole('button',{name:/Continue draft/}).click();
 assert.equal(await page.getByLabel('Inventory ID',{exact:true}).inputValue(),'FA-EDIT-KEPT');
});
