import {useCallback,useLayoutEffect,useRef,useState,type SetStateAction} from 'react';

function read(key:string){
 try{return sessionStorage.getItem(key)||'';}catch{return '';}
}

/** A draft belongs to one account and workspace, and is saved before navigation. */
export function useSessionDraft(key:string){
 const [saved,setSaved]=useState(()=>({key,value:read(key)}));
 const value=saved.key===key?saved.value:read(key);
 const latest=useRef(value);
 useLayoutEffect(()=>{latest.current=value;},[value]);
 const update=useCallback((next:SetStateAction<string>)=>{
  const value=typeof next==='function'?next(latest.current):next;
  latest.current=value;
  try{if(value)sessionStorage.setItem(key,value);else sessionStorage.removeItem(key);}catch{/* The active editor still retains its text. */}
  setSaved({key,value});
 },[key]);
 return [value,update] as const;
}
