import {createRemoteJWKSet,jwtVerify} from 'jose';
const resolvers=new Map();
export class AccessError extends Error {constructor(message,status){super(message);this.status=status}}
export function accessConfiguration(env){
 const team=String(env.TEAM_DOMAIN||'').replace(/\/$/,'');
 const audience=String(env.POLICY_AUD||'').trim();
 if(!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(team)||!audience)throw new AccessError('Cloudflare Access is not configured. Set TEAM_DOMAIN and POLICY_AUD in the Worker settings.',503);
 return {team,audience};
}
export async function verifyAccess(request,env,testKeyResolver){
 const {team,audience}=accessConfiguration(env);
 const assertion=request.headers.get('Cf-Access-Jwt-Assertion');
 if(!assertion)throw new AccessError('Sign in through the inventory domain to access records.',401);
 let keys=testKeyResolver;
 if(!keys){if(!resolvers.has(team)){if(resolvers.size>=4)resolvers.clear();resolvers.set(team,createRemoteJWKSet(new URL(team+'/cdn-cgi/access/certs')))}keys=resolvers.get(team)}
 try{
  const {payload}=await jwtVerify(assertion,keys,{issuer:team,audience,algorithms:['RS256'],requiredClaims:['exp','iat','sub','email']});
  if(typeof payload.sub!=='string'||!payload.sub||typeof payload.email!=='string'||!payload.email.includes('@'))throw Error('Expected a staff identity');
  return {userId:payload.sub,email:payload.email};
 }catch{throw new AccessError('Your sign-in has expired or could not be verified. Reopen the inventory domain and sign in again.',401)}
}
