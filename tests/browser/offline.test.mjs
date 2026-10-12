import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {handleApi} from '../../lib/service.mjs';
import {env} from '../helpers/storage.mjs';

let browser;
before(async()=>{browser=await chromium.launch({headless:true,args:['--no-sandbox']})});
after(()=>browser?.close());
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==','base64');
async function fixture(t){
 const e=env(),state={auth:true,dropSave:false,uploads:0};let origin;
 const server=createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,origin);
   if(url.pathname.startsWith('/api/')){
    if(!state.auth){res.writeHead(401,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Sign in again.'}));return}
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const body=Buffer.concat(chunks);const response=await handleApi(new Request(url,{method:req.method,headers:req.headers,...body.length?{body}:{}}),e,{userId:'offline-test'});
    if(url.pathname==='/api/upload')state.uploads++;
    if(url.pathname==='/api/records'&&req.method==='POST'&&state.dropSave){state.dropSave=false;state.auth=false;res.destroy();return}
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
   }
   const file=url.pathname==='/'?'index.html':url.pathname.slice(1);
   const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.gz':'application/gzip'}[path.extname(file)]||'application/octet-stream';
   const data=await fs.readFile(path.join(process.cwd(),'dist',file));res.writeHead(200,{'Content-Type':mime});res.end(data);
  }catch{res.writeHead(500);res.end('Test server request failed')}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 const context=await browser.newContext({viewport:{width:390,height:844}});t.after(async()=>{await context.close();await new Promise(resolve=>server.close(resolve))});
 const page=await context.newPage();page.setDefaultTimeout(7000);await page.goto(origin);await page.getByRole('button',{name:'New appliance',exact:true}).filter({visible:true}).waitFor();
 await page.getByText('Offline access ready',{exact:true}).waitFor();
 return {page,context,e,state,origin};
}
async function createItem(page,name,ready=false){
 await page.getByRole('button',{name:'New appliance',exact:true}).filter({visible:true}).click();
 for(const label of ['Appliance front','Identification tag']){
  await page.getByRole('button',{name:new RegExp(label+' Tap to take a photo')}).click();
  await page.getByText('Choose photo',{exact:true}).locator('input').setInputFiles({name:'sample.png',mimeType:'image/png',buffer:png});
  await page.getByRole('button',{name:'Use photo',exact:true}).click();
 }
 await page.getByRole('button',{name:/2 Identify/}).click();await page.getByLabel('Brand',{exact:true}).fill(name);
 if(ready){
  await page.getByLabel('Appliance type',{exact:true}).selectOption('Other');
  await page.getByLabel('Model number',{exact:true}).fill('MODEL-1');await page.getByLabel('Serial number',{exact:true}).fill('SERIAL-1');
  await page.getByRole('checkbox',{name:'I checked the label photo and confirm the entered model number.'}).check();
  await page.getByRole('checkbox',{name:'I checked the label photo and confirm the entered serial number.'}).check();
  await page.getByRole('button',{name:/3 Details/}).click();
  await page.getByLabel('Condition',{exact:true}).fill('Good');await page.getByLabel('Location',{exact:true}).fill('Store');await page.getByLabel('Selling price · USD',{exact:true}).fill('25');
  await page.getByRole('button',{name:/4 Review/}).click();await page.getByRole('button',{name:'Save as ready',exact:true}).click();
 }else await page.getByRole('button',{name:'Save draft',exact:true}).click();
 await page.getByRole('dialog',{name:'New appliance intake',exact:true}).waitFor({state:'hidden'});
}

test('two offline entries and their photos survive a reload and sync after reconnection',async t=>{
 const {page,context,e,origin}=await fixture(t);
 await context.setOffline(true);await createItem(page,'Offline one');await createItem(page,'Offline two',true);
 assert.equal((await e.DB.prepare('SELECT * FROM appliances').all()).results.length,0);
 await page.getByText('2 waiting to sync',{exact:true}).waitFor();
 await page.reload();await page.getByRole('button',{name:/Offline one/}).waitFor();await page.getByRole('button',{name:/Offline two/}).waitFor();
 assert.equal(await page.locator('.mobile-record img').count(),2);
 const ready=page.locator('.mobile-record').filter({hasText:'Offline two'});
 await ready.getByRole('checkbox').check();await page.getByRole('button',{name:'Export (1)',exact:true}).click();
 const downloads=[];page.on('download',d=>downloads.push(d));
 await page.getByRole('button',{name:'Download both CSVs',exact:true}).click();
 await page.getByRole('button',{name:'View inventory',exact:true}).click();
 assert.equal(downloads.length,2);
 for(const download of downloads){const csv=await fs.readFile(await download.path(),'utf8');assert.ok(csv.includes('Offline two'));if(download.suggestedFilename().includes('korona'))assert.ok(csv.includes('25.00'));assert.ok(!csv.includes('Offline one'))}
 await page.getByRole('button',{name:/Offline two/}).waitFor();
 assert.equal(await page.getByRole('button',{name:/Offline one/}).count(),0);
 await page.reload();await page.getByRole('tab',{name:'Inventory',exact:true}).click();await page.getByRole('button',{name:/Offline two/}).waitFor();
 assert.equal(await page.locator('.mobile-record img').count(),1);
 await context.setOffline(false);await page.getByText('All items synced',{exact:true}).waitFor();
 const rows=(await e.DB.prepare('SELECT * FROM appliances').all()).results;assert.equal(rows.length,2);
 for(const row of rows){const record=JSON.parse(row.payload);assert.ok(await e.BUCKET.get(record.frontKey));assert.ok(await e.BUCKET.get(record.tagKey))}
 const processed=JSON.parse(rows.find(row=>JSON.parse(row.payload).brand==='Offline two').payload);
 assert.equal(processed.status,'ready');assert.ok(processed.exportedAt);assert.deepEqual(processed.exportKinds,['inventory','korona']);
 assert.equal(JSON.parse(rows.find(row=>JSON.parse(row.payload).brand==='Offline one').payload).exportedAt,undefined);
 // A second device gets the persisted workflow split from the server.
 const other=await browser.newContext({viewport:{width:1280,height:900}});t.after(()=>other.close());const desktop=await other.newPage();
 await desktop.goto(origin);await desktop.getByRole('button',{name:/Offline one/}).waitFor();
 assert.equal(await desktop.getByRole('button',{name:/Offline two/}).count(),0);
 await desktop.getByRole('tab',{name:'Inventory',exact:true}).click();await desktop.getByRole('button',{name:/Offline two/}).waitFor();
 await page.reload();assert.equal((await e.DB.prepare('SELECT * FROM appliances').all()).results.length,2);
});

test('device storage failure leaves the intake open without claiming it saved',async t=>{
 const {page,context,e}=await fixture(t);await context.setOffline(true);
 await page.evaluate(()=>{const original=indexedDB.open.bind(indexedDB);indexedDB.open=(name,...args)=>{if(name==='fussell-inventory')throw new DOMException('Storage full','QuotaExceededError');return original(name,...args)}});
 await page.getByRole('button',{name:'New appliance',exact:true}).filter({visible:true}).click();
 await page.getByRole('button',{name:/2 Identify/}).click();await page.getByLabel('Brand',{exact:true}).fill('Storage failure');await page.getByRole('button',{name:'Save draft',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'This device could not store the item.'}).waitFor();
 assert.equal(await page.getByRole('dialog',{name:'New appliance intake',exact:true}).isVisible(),true);
 assert.equal((await e.DB.prepare('SELECT * FROM appliances').all()).results.length,0);
});

test('a lost save response and expired sign-in keep the local record and retry without duplicates',async t=>{
 const {page,context,e,state}=await fixture(t);
 state.dropSave=true;await createItem(page,'Lost response');
 await page.getByText('1 waiting to sync',{exact:true}).waitFor();
 await page.waitForFunction(()=>document.body.textContent.includes('Sign in')||document.body.textContent.includes('sign-in'));
 assert.equal((await e.DB.prepare('SELECT * FROM appliances').all()).results.length,1);
 assert.equal(state.uploads,2);
 await context.setOffline(true);await page.reload();await page.getByRole('button',{name:/Lost response/}).waitFor();
 state.auth=true;await context.setOffline(false);await page.getByText('All items synced',{exact:true}).waitFor();
 assert.equal((await e.DB.prepare('SELECT * FROM appliances').all()).results.length,1);assert.equal(state.uploads,2);
});
