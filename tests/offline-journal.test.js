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
    Date, AbortSignal, URL, URLSearchParams, crypto:globalThis.crypto, Reservations:require('../reservations.js'),
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
test('two devices: offline reservation rejected safely, restart preserves details and retry books only once',async()=>{
  const fixture={...backup,production:{cookie:1,horn:0,mixed:0},reservations:[],saleEntries:[]};
  let remote={data:structuredClone(fixture),updated_at:'2026-11-16T18:47:45.839Z'};
  let writes=0, loseResponse=false;
  const net=async(url,{method='GET',body}={})=>{
    const q=new URL(url).searchParams;
    let rows=[];
    if(method==='GET')rows=[q.get('select')==='updated_at'?{updated_at:remote.updated_at}:structuredClone(remote)];
    if(method==='PATCH'&&q.get('updated_at')==='eq.'+remote.updated_at){
      remote=JSON.parse(body);writes++;rows=[{updated_at:remote.updated_at}];
      if(loseResponse){loseResponse=false;throw Error('Antwort verloren')}
    }
    return {ok:true,text:async()=>JSON.stringify(rows)};
  };
  const makeStore=()=>new Map([['wm_backen_active_year',String(year)],['wm_backen_year_'+year,JSON.stringify(fixture)]]);
  const a=makeStore(),b=makeStore(),p=phone(a,net),second=phone(b,net);
  const book=(phone,id)=>phone(`(()=>{const cmd={type:'create',id:'op-${id}',reservationId:'${id}',name:'Test ${id}',date:'2026-11-19',at:nowIso(),quantities:{cookie:1,horn:0,mixed:0}};s=Reservations.apply(s,cmd);save(cmd)})()`);
  book(p,'a');book(second,'b');
  await p(`syncYear(${year})`);
  assert.equal(remote.data.reservations.length,1);
  assert.equal(await second(`syncYear(${year})`),'conflict');
  const reopened=phone(b,net);
  assert.equal(reopened(`readYearRecord(${year}).details['op-b'].customer`),'Test b');
  assert.equal(reopened(`readYearRecord(${year}).pending[0]`),'op-b');
  assert.equal(reopened('s.reservations[0].id'),'b');
  assert.equal(await reopened(`syncYear(${year})`),'conflict','no blind automatic replay');
  remote.data.production.cookie=2;
  remote.updated_at=new Date(Date.parse(remote.updated_at)+1000).toISOString();
  remote.data._sync.fieldClocks['production.cookie']=remote.updated_at;
  loseResponse=true;
  await assert.rejects(reopened(`syncYear(${year},true)`),/Antwort verloren/);
  assert.equal(remote.data.reservations.length,2);
  await reopened(`syncYear(${year},true)`);
  assert.equal(remote.data.reservations.filter(x=>x.id==='b').length,1);
  assert.equal(reopened(`readYearRecord(${year}).pending.length`),0);
  assert.equal(reopened(`readYearRecord(${year}).conflict`),null);
  assert.equal(remote.data.purchaseEntries[0].receiptPhoto,fixture.purchaseEntries[0].receiptPhoto);
  assert.equal(remote.data.saleEntries.length,0);
  assert.ok(writes>=2);
});
test('server stock rejection leaves direct sale and the original journal intact',async()=>{
 const fixture={...backup,production:{cookie:1,horn:0,mixed:0},reservations:[],saleEntries:[]};
 const memory=new Map([['wm_backen_active_year',String(year)],['wm_backen_year_'+year,JSON.stringify(fixture)]]);
 const stamp='2026-11-18T12:00:00Z';
 const remote=structuredClone(fixture);
 let patches=0;
 const net=async(url,{method='GET'}={})=>{
   if(method==='PATCH'){
     patches++;
     return {ok:false,status:400,text:async()=>JSON.stringify({code:'23514',message:'WM_STOCK_INSUFFICIENT',details:'cookie'})};
   }
   return {ok:true,text:async()=>JSON.stringify([new URL(url).searchParams.get('select')==='updated_at'?{updated_at:stamp}:{data:remote,updated_at:stamp}])};
 };
 const device=phone(memory,net);
 device("s.saleEntries.push({id:'last-bucket',cookieQty:1,cookiePrice:15});save()");
 const before=JSON.parse(memory.get('wm_backen_journal_v1_'+year));
 assert.equal(await device(`syncYear(${year})`),'conflict');
 const after=JSON.parse(memory.get('wm_backen_journal_v1_'+year));
 assert.deepEqual(after.state,before.state);
 assert.deepEqual(after.pending,before.pending);
 assert.deepEqual(after.details[after.pending[0]].targets,[{label:'Verkauf',id:'last-bucket'}]);
 assert.equal(after.conflict.code,'WM_STOCK_INSUFFICIENT');
 assert.equal(await phone(memory,net)(`syncYear(${year})`),'conflict');
 assert.equal(patches,1);
 assert.deepEqual(remote,fixture);
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
