const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const src = readFileSync(join(__dirname, '../app1.txt'), 'utf8').split('const $=id=>')[0];
// Synthetic project fixture: never commit production snapshots or receipt photos.
const backup = {year:2026,family1:'Römer',family2:'Rusche',purchaseEntries:[
  {id:'existing',buyerKey:'family1',total:4,receiptPhoto:'synthetic-photo-fixture'}
]};
const year = backup.year;
function phone(store, network) {
  const label = {};
  const ctx = vm.createContext({
    Date, AbortSignal, URL, URLSearchParams, crypto:globalThis.crypto,
    location:{hostname:'weihnachtsmarkt-backen.vercel.app',hash:'#workspace=508dd1e5-3fb7-482c-9caf-7219d733ade7'},
    document:{querySelector:()=>null}, navigator:{onLine:false}, addEventListener(){},
    setTimeout(){return 1}, clearTimeout(){}, fetch:(...args)=>network(...args),
    localStorage:{get length(){return store.size},key:i=>[...store.keys()][i],getItem:k=>store.get(k)??null,
      setItem(k,v){if(store.fail&&k.startsWith('wm_backen_journal'))throw Error('Quota');store.set(k,v)}},
    label, render(){}
  });
  vm.runInContext(src+'\nconst $=()=>label;',ctx);
  return expr=>vm.runInContext(expr,ctx);
}
const stored = () => new Map([['wm_backen_active_year',String(year)],['wm_backen_year_'+year,JSON.stringify(backup)]]);
const add = (p,id) => p(`s.purchaseEntries.push({id:'${id}',buyerKey:'neutral',total:10});save()`);
test('offline purchase survives restart; failed storage does not confirm or leave a phantom purchase',()=>{
  const data=stored(), p=phone(data);
  add(p,'offline1');
  const reopened=phone(data);
  assert.equal(reopened(`readYearRecord(${year}).pending.length`),1);
  assert.equal(reopened("s.purchaseEntries.at(-1).id"),'offline1');
  data.fail=true;
  assert.throws(()=>add(reopened,'failed'),/Quota/);
  assert.equal(reopened("s.purchaseEntries.some(e=>e.id==='failed')"),false);
  assert.equal(phone(data)("s.purchaseEntries.at(-1).id"),'offline1');
});
test('four isolated journals merge; two clean polls fetch metadata only; historical photos stay intact',async()=>{
  let remote={data:structuredClone(backup),updated_at:'2026-11-16T18:47:45.839Z'};
  const log=[];
  const net=async(url,{method='GET',body}={})=>{
    const q=new URL(url).searchParams;
    log.push([method,q.get('select')]);
    let rows=[];
    if(method==='GET')rows=[q.get('select')==='updated_at'?{updated_at:remote.updated_at}:structuredClone(remote)];
    if(method==='PATCH'&&q.get('updated_at')==='eq.'+remote.updated_at){remote=JSON.parse(body);rows=[{updated_at:remote.updated_at}]}
    return {ok:true,text:async()=>JSON.stringify(rows)};
  };
  const data=Array.from({length:4},stored);
  data.forEach((d,i)=>add(phone(d,net),'purchase'+i));
  const devices=data.map(d=>phone(d,net));
  await Promise.all(devices.map(p=>p(`syncYear(${year})`)));
  await Promise.all(devices.map(p=>p(`syncYear(${year})`)));
  assert.equal(remote.data.purchaseEntries.length,backup.purchaseEntries.length+4);
  for(const p of devices)assert.equal(p(`readYearRecord(${year}).pending.length`),0);
  for(const old of backup.purchaseEntries)assert.equal(remote.data.purchaseEntries.find(e=>e.id===old.id).receiptPhoto,old.receiptPhoto);
  log.length=0;
  await devices[0](`syncYear(${year})`);
  await devices[0](`syncYear(${year})`);
  assert.deepEqual(log,[['GET','updated_at'],['GET','updated_at']]);
});
