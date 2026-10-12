import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeIdentifier,spokenIdentifier,compareIdentifiers,extractTag,parseMoney,validateRecord,makeCsv,exportRows,readyErrors} from '../lib/domain.mjs';
const record={id:'9e8aad8b-812b-48dd-930d-310bc9d8200a',inventoryId:'FA-000003',type:'Dryer',brand:'Samsung',model:'DV56H9100EG/A2',serial:'0BH95AEG900840J',location:'Ball',condition:'Used - Grade B',testStatus:'Passed',status:'ready',price:'399.95',cost:'150',notes:'',frontKey:'photos/front',tagKey:'photos/tag',ocrModel:'DV56H9100EG/A2',ocrSerial:'0BH95AEG900840J',modelReviewed:false,serialReviewed:false};
test('identifier comparison keeps zero and O different and preserves suffixes',()=>{
 assert.equal(normalizeIdentifier(' ab 01/a-2 '),'AB01/A-2');
 assert.equal(compareIdentifiers('AB01','ABO1').status,'mismatch');
 assert.deepEqual(compareIdentifiers('AB01','ABO1').positions,[3]);
 assert.equal(compareIdentifiers('AB01','').status,'unread');
 assert.equal(compareIdentifiers('dv56/a2','DV56/A2').status,'match');
});
test('spoken spelling supports phonetic words, numbers and punctuation without guessing unknown prose',()=>{
 assert.equal(spokenIdentifier('D V five six H nine one zero zero E G slash A two'),'DV56H9100EG/A2');
 assert.equal(spokenIdentifier('zero bravo hotel nine five alpha echo golf'),'0BH95AEG');
 assert.equal(spokenIdentifier('B as in boy zero'),'B0');
 assert.equal(spokenIdentifier('oh one'),'O1');
});
test('tag extraction recognizes labeled fields and preserves slash suffix',()=>{
 assert.deepEqual(extractTag('SAMSUNG\nMODEL NO.: DV56H9100EG/A2\nSERIAL NO.: 0BH95AEG900840J\nCLOTHES DRYER'),{brand:'Samsung',type:'Dryer',model:'DV56H9100EG/A2',serial:'0BH95AEG900840J'});
 assert.equal(extractTag('unreadable').serial,'');
});
test('money parser uses exact cents and rejects ambiguous/negative values',()=>{
 assert.equal(parseMoney('399.95'),39995);assert.equal(parseMoney('$1,299.00'),129900);
 assert.equal(parseMoney(''),null);assert.throws(()=>parseMoney('-2'));assert.throws(()=>parseMoney('12.345'));assert.throws(()=>parseMoney('five hundred'));
});
test('ready record requires photos details and explicit mismatch review',()=>{
 assert.equal(readyErrors(record).length,0);
 assert.ok(readyErrors({...record,ocrSerial:'OBH95AEG900840J'}).some(x=>x.includes('serial')));
 assert.equal(readyErrors({...record,ocrSerial:'OBH95AEG900840J',serialReviewed:true}).length,0);
 assert.ok(readyErrors({...record,tagKey:''}).some(x=>x.includes('tag')));
 assert.ok(readyErrors({...record,price:''}).length);
 assert.throws(()=>validateRecord({...record,status:'anything'}));
});
test('drafts permit incomplete records while invalid price still rejected',()=>{
 assert.doesNotThrow(()=>validateRecord({...record,status:'draft',serial:'',price:''}));
 assert.throws(()=>validateRecord({...record,price:'-10'}));
});
test('CSV escapes commas quotes and formula cells',()=>{
 assert.equal(makeCsv([['name','note'],['washer, dryer','a "quote"'],['=SUM(A1)','@bad']]),'\uFEFF"name","note"\r\n"washer, dryer","a ""quote"""\r\n"\'=SUM(A1)","\'@bad"\r\n');
});
test('KORONA export excludes drafts and has retail price and track inventory columns',()=>{
 const rows=exportRows([record,{...record,status:'draft'}],'korona','https://example.com');
 assert.equal(rows.length,2);assert.ok(rows[0].includes('Product - Product Retail Price'));assert.ok(rows[1].includes('399.95'));assert.ok(rows[1].includes('1'));
});
