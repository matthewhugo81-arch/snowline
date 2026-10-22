import {PRODUCT_BASE,productPath} from './map-ensemble-products.js?v=20261022-ireland-ecmwf-range';
// GitHub Pages gzips .om responses, including byte ranges. A range into the
// compressed representation cannot be decoded as an OM chunk. The deployment
// uses a non-compressible MIME suffix for these already-compressed binary files.
// Logical OM URLs stay unchanged for domain parsing, frame keys and timestamps.
const installed=new WeakSet();
export function installEnsembleTransport(OM,settings,base=new URL('./ensemble-data/',import.meta.url).href){
 const companion='https://matthewhugo81-arch.github.io/snowline-ensembles/ensemble-data/';
 const archive=url=>url.match(/^https:\/\/raw\.githubusercontent\.com\/matthewhugo81-arch\/snowline\/[a-f0-9]{40}\/ensemble-data\/(snowline_(?:ecmwf|gefs)_ensemble\/.*)$/)?.[1];
 const own=url=>!!productPath(url)||url.startsWith(PRODUCT_BASE)||url.startsWith(base)||url.startsWith(companion)||!!archive(url);
 const reader=OM.getProtocolInstance(settings).omFileReader;
 if(installed.has(reader))return;
 installed.add(reader);
 const original=reader.withReader.bind(reader);
 // These compact statistical files store their directory at the end. A
 // 256 KiB read for that small directory also downloads unrelated fields;
 // the next native-grid read can waste another block. Keep the normal large
 // model cache unchanged and use smaller, bounded blocks for measured ENS
 // feeds. Both caches retain the renderer's URL/version-aware block keys.
 const compact=/^(?:snowline_gefs_ensemble|snowline_ecmwf_ensemble|snowline_gefs_extra_v2|snowline_ecmwf_extra_v2|snowline_mogreps_global|snowline_(?:ecmwf|gefs|mogreps_uk|mogreps_g)_products)\//;
 const pool=reader.backendPool;
 const ensembleCache=OM.LruBlockCache&&typeof pool?.withReader==='function'?new OM.LruBlockCache(64*1024,256):null;
 reader.withReader=(url,callback)=>{
  const path=productPath(url)??(url.startsWith(PRODUCT_BASE)?url.slice(PRODUCT_BASE.length):url.startsWith(base)?url.slice(base.length):url.startsWith(companion)?url.slice(companion.length):archive(url));
  const binary=own(url)&&url.endsWith('.om')?url+'.png':url;
  return ensembleCache&&path&&compact.test(path)&&/\.om(?:\.png)?$/.test(url)
   ?pool.withReader(binary,ensembleCache,callback)
   :original(binary,callback);
 };
 // Ensemble scalar speeds and their spread have no direction. Bypass the
 // general speed/direction pairing only for these verified companion fields.
 // Prefetch already tolerates absent secondary variables and warms the speed.
 if(typeof reader.readVariable==='function'&&typeof reader.readSimpleVariable==='function'){
  const read=reader.readVariable.bind(reader);
  reader.readVariable=(url,key,ranges=null,signal)=>
   (((url.startsWith(base+'snowline_ecmwf_extra_v2/')||url.startsWith(companion+'snowline_ecmwf_extra_v2/'))&&/^wind_speed_(?:10m_mean|(?:250|850)hPa_(?:mean|spread))$/.test(key))||((url.startsWith(base+'snowline_mogreps_global/')||url.startsWith(companion+'snowline_mogreps_global/'))&&/^wind_speed_(?:300|200)hPa_(?:mean|spread)$/.test(key)))
    ?reader.withReader(url,file=>reader.readSimpleVariable(file,key,ranges,signal))
    :read(url,key,ranges,signal);
 }
}
