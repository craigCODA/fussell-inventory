import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportJWK,SignJWT,createLocalJWKSet} from 'jose';
import {verifyAccess} from '../worker/access.mjs';
import {handleRequest} from '../worker/index.mjs';
const {privateKey,publicKey}=await generateKeyPair('RS256');
const jwk=await exportJWK(publicKey);jwk.kid='test-key';
const resolveKey=createLocalJWKSet({keys:[jwk]});
const env={TEAM_DOMAIN:'https://inventory-team.cloudflareaccess.com',POLICY_AUD:'inventory-audience'};
async function token(overrides={}){return new SignJWT({email:'operator@example.test',...overrides}).setProtectedHeader({alg:'RS256',kid:'test-key'}).setSubject('verified-operator').setIssuer(env.TEAM_DOMAIN).setAudience(env.POLICY_AUD).setIssuedAt().setExpirationTime('5m').sign(privateKey)}
const request=value=>new Request('https://inventory.example.test/api/records',{headers:value?{'Cf-Access-Jwt-Assertion':value}:{}});
test('API fails closed before Cloudflare Access is configured',async()=>{const response=await handleRequest(request(),{ASSETS:{fetch(){throw Error('must not serve SPA for API')}}});assert.equal(response.status,503);assert.match((await response.json()).error,/access/i)});
test('ChatGPT identity headers and arbitrary email headers cannot authorize inventory',async()=>{const response=await handleRequest(new Request('https://inventory.example.test/api/records',{headers:{'oai-authenticated-user-id':'spoof','oai-authenticated-user-email':'owner@example.test','Cf-Access-Authenticated-User-Email':'owner@example.test'}}),env);assert.equal(response.status,401)});
test('verified signed Access token supplies identity',async()=>{assert.deepEqual(await verifyAccess(request(await token()),env,resolveKey),{userId:'verified-operator',email:'operator@example.test'})});
test('wrong audience, wrong issuer, expired and tampered tokens fail',async()=>{
 const base=()=>new SignJWT({email:'operator@example.test'}).setProtectedHeader({alg:'RS256',kid:'test-key'}).setSubject('operator').setIssuedAt();
 const tokens=await Promise.all([base().setIssuer(env.TEAM_DOMAIN).setAudience('different-app').setExpirationTime('5m').sign(privateKey),base().setIssuer('https://other.cloudflareaccess.com').setAudience(env.POLICY_AUD).setExpirationTime('5m').sign(privateKey),base().setIssuer(env.TEAM_DOMAIN).setAudience(env.POLICY_AUD).setExpirationTime('1 second ago').sign(privateKey)]);
 const valid=await token();const parts=valid.split('.');parts[1]=Buffer.from(JSON.stringify({email:'attacker@example.test',sub:'attacker',aud:env.POLICY_AUD,iss:env.TEAM_DOMAIN,exp:Date.now()/1000+600})).toString('base64url');tokens.push(parts.join('.'));
 for(const value of tokens)await assert.rejects(verifyAccess(request(value),env,resolveKey));
});
test('a signed token without an email cannot become a staff session',async()=>{await assert.rejects(verifyAccess(request(await token({email:null})),env,resolveKey))});
test('all non-API URLs are served by the static assets binding',async()=>{const response=await handleRequest(new Request('https://inventory.example.test/ocr/worker.min.js'),{ASSETS:{fetch:async()=>new Response('static')}});assert.equal(await response.text(),'static')});
