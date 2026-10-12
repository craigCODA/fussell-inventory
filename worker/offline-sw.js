const SHELL=__CACHE_NAME__;
const MEDIA='fussell-offline-media-v1';
const PRECACHE=__PRECACHE__;
async function checkedFetch(url){
 const response=await fetch(url,{cache:'reload',credentials:'same-origin'});
 if(!response.ok||response.redirected)throw Error('Offline files could not be prepared.');
 if(url==='/'&&!(await response.clone().text()).includes('name="fussell-app"'))throw Error('Sign in before preparing offline access.');
 if(url!=='/'&&response.headers.get('Content-Type')?.includes('text/html'))throw Error('Unexpected sign-in page.');
 return response;
}
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(SHELL);
 await Promise.all(PRECACHE.map(async url=>cache.put(url,await checkedFetch(url))));
 await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 for(const name of await caches.keys())if(name.startsWith('fussell-shell-')&&name!==SHELL)await caches.delete(name);
 await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin)return;
 // Authentication and API writes always go to the server. Offline records and
 // pending writes live in IndexedDB, never in a cached API response.
 if(url.pathname.startsWith('/cdn-cgi/')||url.pathname==='/sw.js')return;
 if(url.pathname==='/api/media'){
  event.respondWith((async()=>{
   const cache=await caches.open(MEDIA);
   try{const response=await fetch(request);const mime=response.headers.get('Content-Type')||'';
    if(response.ok&&!response.redirected&&/^(image|audio|video)\//.test(mime))event.waitUntil(cache.put(request,response.clone()).catch(()=>{}));
    return response;
   }catch{return await cache.match(request)||Response.error()}
  })());return;
 }
 if(url.pathname.startsWith('/api/'))return;
 if(request.mode==='navigate'){
  event.respondWith(fetch(request).then(async response=>{
   if(response.status>=500)return await caches.match('/')||response;
   return response;
  }).catch(async()=>await caches.match('/')||Response.error()));return;
 }
 if(PRECACHE.includes(url.pathname)||url.pathname.startsWith('/assets/')||url.pathname.startsWith('/ocr/')){
  event.respondWith((async()=>{
   const cached=await caches.match(request);if(cached)return cached;
   const response=await fetch(request);
   if(response.ok&&!response.redirected&&!response.headers.get('Content-Type')?.includes('text/html'))event.waitUntil(caches.open(SHELL).then(cache=>cache.put(request,response.clone())).catch(()=>{}));
   return response;
  })());
 }
});
