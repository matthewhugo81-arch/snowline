// A native/WASM reader must outlive every operation using it, including when
// one parallel input is cancelled or fails before its siblings have finished.
export async function settleNativeReads(reads){
 const results=await Promise.allSettled(reads);
 const failed=results.find(result=>result.status==='rejected');
 if(failed)throw failed.reason;
 return results.map(result=>result.value);
}
