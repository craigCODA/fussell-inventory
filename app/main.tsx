import {createRoot} from 'react-dom/client';
import InventoryApp from './InventoryApp';
import './globals.css';
createRoot(document.getElementById('root')!).render(<InventoryApp/>);
if(import.meta.env.PROD&&'serviceWorker' in navigator){
 window.addEventListener('load',()=>{
  void navigator.serviceWorker.register('/sw.js').then(()=>navigator.serviceWorker.ready).then(()=>window.dispatchEvent(new Event('inventory-offline-ready'))).catch(()=>{});
 });
}
