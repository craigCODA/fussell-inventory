import {verifyAccess} from './access.mjs';
import {handleApi} from '../lib/service.mjs';
export async function handleRequest(request,env){
 const url=new URL(request.url);
 if(!url.pathname.startsWith('/api/'))return env.ASSETS.fetch(request);
 try{
  const user=await verifyAccess(request,env);
  if(url.pathname==='/api/session')return Response.json({email:user.email},{headers:{'Cache-Control':'no-store'}});
  return await handleApi(request,env,user);
 }catch(error){return Response.json({error:error.status?error.message:'The server could not complete this request. Please try again.'},{status:error.status||500,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})}
}
export default {fetch:handleRequest};
