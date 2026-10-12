import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
test('initial migration can be adopted by Wrangler after dashboard setup without losing inventory',()=>{const db=new DatabaseSync(':memory:');const sql=readFileSync('migrations/0001_inventory.sql','utf8');db.exec(sql);db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('existing','"preserved"');db.exec(sql);assert.equal(db.prepare('SELECT value FROM settings WHERE key=?').get('existing').value,'"preserved"');db.close()});
