import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export default defineConfig({plugins:[react(),{
 name:'inventory-offline-shell',generateBundle(_options,bundle){
  const urls=['/','/favicon.svg',...Object.keys(bundle).filter(name=>/\.(js|css)$/.test(name)).map(name=>'/'+name)];
  const version=createHash('sha256').update(JSON.stringify(urls)+String((bundle['index.html'] as {source?:string})?.source)).digest('hex').slice(0,12);
  const source=readFileSync('worker/offline-sw.js','utf8').replace('__CACHE_NAME__',JSON.stringify('fussell-shell-'+version)).replace('__PRECACHE__',JSON.stringify(urls));
  this.emitFile({type:'asset',fileName:'sw.js',source});
 }
}],build:{outDir:'dist',emptyOutDir:true}});
