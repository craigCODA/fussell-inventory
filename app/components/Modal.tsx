'use client';
import {useEffect,useRef,type ReactNode} from 'react';
export default function Modal({children,onClose,label,className=''}:{children:ReactNode;onClose:()=>void;label:string;className?:string}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const d=ref.current;d?.showModal();return ()=>d?.close()},[]);
 return <dialog ref={ref} className={'modal '+className} aria-label={label} onCancel={e=>{e.preventDefault();onClose()}}>{children}</dialog>;
}
