/* Guard before any app normalization, journal write or synchronization. */
(() => {
 'use strict';
 const VERSION='10.5.6', DB='wm-update-checkpoints-v1', STORE='snapshots';
 const MARKER='wm_update_activated_'+VERSION;
 function localEntries(){
   const keys=[];
   for(let i=0;i<localStorage.length;i++){
     const key=localStorage.key(i);
     if(key?.startsWith('wm_backen_'))keys.push(key);
   }
   return keys.sort().map(key=>{
     const value=localStorage.getItem(key);
     if(value===null)throw new Error('Local state changed during capture');
     return [key,value];
   });
 }
 function checkLocal(entries){
   let hasState=false;
   for(const [key,value] of entries){
     if(!/^wm_backen_(?:v2$|year_\d+$|journal_v1_\d+$)/.test(key))continue;
     const state=JSON.parse(value);
     if(!state||typeof state!=='object'||Array.isArray(state))throw new Error('Invalid local backup source');
     const journalPrefix='wm_backen_journal_v1_';
     if(key.startsWith(journalPrefix)&&(!state.state||!Array.isArray(state.pending)||Number(state.state.year)!==Number(key.slice(journalPrefix.length))))
       throw new Error('Invalid local journal');
     hasState=true;
   }
   if(window.AndroidBridge&&!hasState)throw new Error('No earlier app state visible on this origin');
 }
 async function checksum(raw){
   const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw));
   return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
 }
 function openDatabase(){
   return new Promise((resolve,reject)=>{
     let ended=false;
     const fail=e=>{if(!ended){ended=true;clearTimeout(timer);reject(e)}};
     const req=indexedDB.open(DB,1);
     const timer=setTimeout(()=>fail(new Error('Checkpoint storage timed out')),7000);
     req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE)};
     req.onerror=()=>fail(req.error);
     req.onblocked=()=>fail(new Error('Checkpoint storage blocked'));
     req.onsuccess=()=>{if(ended){req.result.close();return}ended=true;clearTimeout(timer);resolve(req.result)};
   });
 }
 function transact(db,mode,operation){
   return new Promise((resolve,reject)=>{
     let tx;
     if(mode==='readwrite'){
       try{tx=db.transaction(STORE,mode,{durability:'strict'})}
       catch(error){if(!(error instanceof TypeError))throw error;tx=db.transaction(STORE,mode)}
     }else tx=db.transaction(STORE,mode);
     const timer=setTimeout(()=>{try{tx.abort()}catch(_error){}reject(new Error('Checkpoint transaction timed out'))},7000);
     const fail=()=>{clearTimeout(timer);reject(tx.error||new Error('Checkpoint transaction failed'))};
     let req;
     tx.onabort=fail;tx.onerror=fail;
     tx.oncomplete=()=>{clearTimeout(timer);resolve(req.result)};
     try{req=operation(tx.objectStore(STORE))}
     catch(error){clearTimeout(timer);try{tx.abort()}catch(_error){}reject(error)}
   });
 }
 async function validate(record){
   if(!record||record.version!==VERSION||typeof record.raw!=='string'||await checksum(record.raw)!==record.digest)
     throw new Error('Checkpoint could not be verified');
   const entries=JSON.parse(record.raw);
   if(!Array.isArray(entries)||entries.some(row=>!Array.isArray(row)||row.length!==2||typeof row[0]!=='string'||typeof row[1]!=='string'))
     throw new Error('Checkpoint format invalid');
   return entries;
 }
 async function prepare(){
   const marker=localStorage.getItem(MARKER);
   const db=await openDatabase();
   try{
     if(marker!==null){
       const prior=await transact(db,'readonly',s=>s.get(VERSION));await validate(prior);
       if(marker!==prior.digest)throw new Error('Checkpoint marker does not match');
       return ()=>{};
     }
     const entries=localEntries();checkLocal(entries);
     const raw=JSON.stringify(entries),record={version:VERSION,capturedAt:new Date().toISOString(),raw,digest:await checksum(raw)};
     const existing=await transact(db,'readonly',s=>s.get(VERSION));
     if(existing){
       await validate(existing);
       if(existing.raw!==raw)throw new Error('An earlier checkpoint must not be overwritten');
     }else await transact(db,'readwrite',s=>s.add(record,VERSION));
     const saved=await transact(db,'readonly',s=>s.get(VERSION));await validate(saved);
     if(saved.raw!==raw||saved.digest!==record.digest)throw new Error('Checkpoint differs from local state');
     return ()=>{
       // No asynchronous work between this comparison and app execution.
       if(JSON.stringify(localEntries())!==raw)throw new Error('Local state changed before startup');
       localStorage.setItem(MARKER,record.digest);
     };
   }finally{db.close()}
 }
 async function exportCopy(){
   const db=await openDatabase();
   try{
     const saved=await transact(db,'readonly',s=>s.get(VERSION)),entries=await validate(saved);
     return {format:'wm-update-checkpoint-v1',version:VERSION,capturedAt:saved.capturedAt,digest:saved.digest,
       storage:Object.fromEntries(entries)};
   }finally{db.close()}
 }
 async function downloadCopy(){
   const data=await exportCopy(),name='weihnachtsmarkt-sicherung-vor-'+VERSION+'.json',json=JSON.stringify(data);
   if(window.AndroidBridge?.saveJson){window.AndroidBridge.saveJson(name,json);return}
   const url=URL.createObjectURL(new Blob([json],{type:'application/json'})),link=document.createElement('a');
   link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 window.WMStartupCheckpoint={prepare,exportCopy,downloadCopy};
})();
