import {useEffect,useEffectEvent,useId,Children,isValidElement,type ReactNode,type HTMLAttributes} from 'react';
import {toast} from 'sonner';
export function FloatingNotice({children}:HTMLAttributes<HTMLElement>){
 const id=useId();
 const flatten=(value:ReactNode):string=>Children.toArray(value).map(child=>typeof child==='string'||typeof child==='number'?String(child):isValidElement<{children?:ReactNode}>(child)?flatten(child.props.children):'').join('');
 const nodes=Children.toArray(children);
 const text=flatten(nodes.filter(child=>!isValidElement(child)||child.type!=="button"));
 const actions=nodes.filter(child=>isValidElement(child)&&child.type==="button"&&flatten(child));
 const show=useEffectEvent(()=>toast.error(text,{id,duration:7000,action:actions.length?<>{actions}</>:undefined}));
 useEffect(()=>{
  if(!text)return;
  show();
  return()=>{toast.dismiss(id);};
 },[text,id]);
 return null;
}
