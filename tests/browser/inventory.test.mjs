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
