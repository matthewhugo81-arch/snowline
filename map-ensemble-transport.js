// GitHub Pages gzips .om responses, including byte ranges. A range into the
// compressed representation cannot be decoded as an OM chunk. The deployment
// uses a non-compressible MIME suffix for these already-compressed binary files.
// Logical OM URLs stay unchanged for domain parsing, frame keys and timestamps.
export function installEnsembleTransport(OM,settings,base=new URL('./ensemble-data/',import.meta.url).href){
 const reader=OM.getProtocolInstance(settings).omFileReader;
 const original=reader.withReader.bind(reader);
 reader.withReader=(url,callback)=>original(url.startsWith(base)&&url.endsWith('.om')?url+'.png':url,callback);
}
