// GitHub Pages gzips .om responses, including byte ranges. A range into the
// compressed representation cannot be decoded as an OM chunk. The deployment
// uses a non-compressible MIME suffix for these already-compressed binary files.
// Logical OM URLs stay unchanged for domain parsing, frame keys and timestamps.
const installed=new WeakSet();
export function installEnsembleTransport(OM,settings,base=new URL('./ensemble-data/',import.meta.url).href){
 const reader=OM.getProtocolInstance(settings).omFileReader;
 if(installed.has(reader))return;
 installed.add(reader);
 const original=reader.withReader.bind(reader);
 reader.withReader=(url,callback)=>original(url.startsWith(base)&&url.endsWith('.om')?url+'.png':url,callback);
 // Ensemble scalar speeds and their spread have no direction. Bypass the
 // general speed/direction pairing only for these verified companion fields.
 // Prefetch already tolerates absent secondary variables and warms the speed.
 if(typeof reader.readVariable==='function'&&typeof reader.readSimpleVariable==='function'){
  const read=reader.readVariable.bind(reader);
  reader.readVariable=(url,key,ranges=null,signal)=>
   url.startsWith(base+'snowline_ecmwf_extra/')&&/^wind_speed_(?:10m_mean|(?:250|850)hPa_(?:mean|spread))$/.test(key)
    ?reader.withReader(url,file=>reader.readSimpleVariable(file,key,ranges,signal))
    :read(url,key,ranges,signal);
 }
}
