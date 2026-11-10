import {useEffect, useId, useRef, type ReactNode} from 'react';
import {Button} from './BoardPrimitives';

export function Confirm({title, children, onConfirm, onClose, actionLabel='确认保存'}: {title:string;children:ReactNode;onConfirm:()=>void;onClose:()=>void;actionLabel?:string}) {
 const ref=useRef<HTMLDialogElement>(null),id=useId();
 useEffect(()=>{const element=ref.current,previous=document.activeElement;element?.showModal();return()=>{element?.close();if(previous instanceof HTMLElement&&previous.isConnected)previous.focus()}},[]);
 return <dialog ref={ref} className="settings-confirm" aria-labelledby={id} onCancel={event=>{event.stopPropagation();onClose()}} onClose={event=>{event.stopPropagation();onClose()}}>
  <h2 id={id}>{title}</h2><div>{children}</div><div className="inline-actions"><Button autoFocus onClick={onClose}>取消</Button><Button variant="primary" onClick={()=>{onClose();onConfirm()}}>{actionLabel}</Button></div>
 </dialog>;
}
