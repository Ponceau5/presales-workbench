export type ModelTaskStatus = "running"|"cancelling"|"completed"|"failed"|"cancelled"|"interrupted";
export async function waitForTaskEnd(read:()=>Promise<{status:ModelTaskStatus}>,signal:AbortSignal,pause=500):Promise<ModelTaskStatus>{
 let failures=0;
 while(!signal.aborted){
  try{
   const {status}=await read();failures=0;
   if(!["running","cancelling"].includes(status))return status;
  }catch(error){if(++failures>=3)throw error;}
  await new Promise<void>(resolve=>{
   const done=()=>{clearTimeout(timer);signal.removeEventListener("abort",done);resolve();};
   const timer=setTimeout(done,pause);signal.addEventListener("abort",done,{once:true});
  });
 }
 throw new DOMException("任务状态读取已停止","AbortError");
}

export async function cancelBeforeDisconnect(cancel:()=>Promise<unknown>,disconnect:()=>void){
 try{await cancel();}finally{disconnect();}
}
