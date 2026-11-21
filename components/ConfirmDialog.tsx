'use client';

import {createContext, useContext, useEffect, useId, useRef, useState, type ReactNode} from 'react';
import {AlertTriangle, CheckCircle2, LoaderCircle} from 'lucide-react';

type Confirmation = {
 title:string;
 description:string;
 confirmLabel:string;
 successMessage:string;
 onConfirm:()=>Promise<unknown>;
};
const ConfirmContext=createContext<((options:Confirmation)=>void)|null>(null);
export function useConfirm(){
 const confirm=useContext(ConfirmContext);
 if(!confirm)throw Error('ConfirmDialogProvider ausente.');
 return confirm;
}

export function ConfirmDialogProvider({children}:{children:ReactNode}){
 const [options,setOptions]=useState<Confirmation|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[closing,setClosing]=useState(false),[notice,setNotice]=useState('');
 const dialog=useRef<HTMLDialogElement>(null),cancel=useRef<HTMLButtonElement>(null),trigger=useRef<HTMLElement|null>(null);
 const running=useRef(false),visible=useRef(false),closeTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const titleId=useId(),descriptionId=useId();

 useEffect(()=>{
  if(!options)return;
  const previousOverflow=document.body.style.overflow;
  document.body.style.overflow='hidden';
  dialog.current?.showModal();
  cancel.current?.focus();
  return ()=>{document.body.style.overflow=previousOverflow;};
 },[options]);
 useEffect(()=>()=>{if(closeTimer.current)clearTimeout(closeTimer.current);},[]);
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),4500);return ()=>clearTimeout(timer);},[notice]);

 function close(){
  if(running.current||closing)return;
  setClosing(true);
  closeTimer.current=setTimeout(()=>{
   dialog.current?.close();setOptions(null);setClosing(false);visible.current=false;
   const target=trigger.current?.isConnected?trigger.current:document.querySelector<HTMLElement>('.nav-btn.active');
   target?.focus({preventScroll:true});
  },160);
 }
 function ask(next:Confirmation){
  if(visible.current)return;
  visible.current=true;trigger.current=document.activeElement as HTMLElement;
  setNotice('');setError('');setOptions(next);
 }
 async function submit(){
  if(running.current||closing||!options)return;
  running.current=true;setBusy(true);setError('');
  try{
   await options.onConfirm();
   setNotice(options.successMessage);running.current=false;close();
  }catch(e){setError(e instanceof Error?e.message:'Não foi possível concluir. Tente novamente.');}
  finally{running.current=false;setBusy(false);}
 }

 return <ConfirmContext.Provider value={ask}>{children}
  {notice&&<div className="toast confirm-toast" role="status"><CheckCircle2 size={18} aria-hidden="true"/>{notice}</div>}
  {options&&<dialog ref={dialog} className={`confirm-dialog ${closing?'is-closing':''}`} aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={busy} onCancel={e=>{e.preventDefault();close();}} onKeyDown={e=>{
   if(e.key!=='Tab')return;
   const buttons=Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
   const first=buttons[0],last=buttons[buttons.length-1];
   if(!first){e.preventDefault();return;}
   if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
   else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  }}>
   <div className="confirm-symbol"><AlertTriangle size={25} aria-hidden="true"/></div>
   <p className="confirm-eyebrow">CUIDADO COM SEUS REGISTROS</p>
   <h2 id={titleId}>{options.title}</h2>
   <p id={descriptionId} className="confirm-description">{options.description}</p>
   {error&&<p className="error" role="alert">{error}</p>}
   <div className="confirm-buttons"><button ref={cancel} className="soft-btn" disabled={busy||closing} onClick={close}>Cancelar</button><button className="danger-btn" disabled={busy||closing} onClick={submit}>{busy&&<LoaderCircle className="spin" size={16} aria-hidden="true"/>}{busy?'Aguarde…':options.confirmLabel}</button></div>
  </dialog>}
 </ConfirmContext.Provider>;
}
