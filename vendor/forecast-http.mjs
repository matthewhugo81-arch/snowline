// One deadline covers headers AND body consumption. A timed-out attempt must
// release its network request before retrying; callers retain shared-read ownership.
const abortReason=signal=>signal.reason??new DOMException('Aborted','AbortError');
function wait(ms,signal){
 return new Promise((resolve,reject)=>{
  signal?.throwIfAborted();
  const cancel=()=>{clearTimeout(timer);reject(abortReason(signal));};
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',cancel);resolve();},ms);
  signal?.addEventListener('abort',cancel,{once:true});
 });
}
export async function forecastRequest(url,init,timeoutMs=5000,attempts=3,signal,consume=response=>response){
 for(let attempt=0;attempt<Math.max(1,attempts);attempt++){
  signal?.throwIfAborted();
  const controller=new AbortController();
  const cancel=()=>controller.abort(abortReason(signal));
  signal?.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(()=>controller.abort(new DOMException('Forecast request timed out after '+timeoutMs+'ms','TimeoutError')),timeoutMs);
  let onAbort,response,failure;
  const aborted=new Promise((resolve,reject)=>{
   onAbort=()=>reject(abortReason(controller.signal));
   controller.signal.addEventListener('abort',onAbort,{once:true});
  });
  try{
   return await Promise.race([aborted,(async()=>{
    response=await fetch(url,{...init,signal:controller.signal});
    controller.signal.throwIfAborted();
    if(!response.ok)throw Object.assign(Error('HTTP error: '+response.status),{status:response.status,statusCode:response.status});
    const result=await consume(response,controller.signal);
    controller.signal.throwIfAborted();return result;
   })()]);
  }catch(error){
   failure=error;
   // Also cancel rejected responses before backoff, including a partially read body.
   controller.abort(error);
   void response?.body?.cancel().catch(()=>{});
  }finally{
   clearTimeout(timer);signal?.removeEventListener('abort',cancel);
   controller.signal.removeEventListener('abort',onAbort);
  }
  signal?.throwIfAborted();
  const permanent=Number.isFinite(failure?.status)&&failure.status!==429&&failure.status<500;
  if(permanent||attempt+1>=Math.max(1,attempts))throw failure;
  await wait(Math.min(500*2**attempt,5000),signal);
 }
}
