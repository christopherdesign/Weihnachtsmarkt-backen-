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

test('four offline device snapshots converge to the configured Cloer without touching history',async()=>{
  const actual={id:'device-218873e0-fb8b-428f-8989-edc625da705a',name:'Cloer',type:'Hörncheneisen',family:'Rusche',watts:800,ironCount:5};
  const auto={...actual,id:'dev-rusche-iron',name:'Cloer Hörncheneisen',ironCount:1};
  const separate={...actual,id:'unverified-same-name',ironCount:2};
  const sensitiveFields={id:'old-energy',deviceId:actual.id,watts:4000,powerPrice:.25,cost:.5,durationMs:1800000,family:'Rusche'};
  const fixture={...backup,energyLogs:[sensitiveFields],energyConfig:{prices:{Rusche:.25},devices:[actual,separate]}};
  let remote={data:structuredClone(fixture),updated_at:'2026-11-18T20:59:59.114Z'};
  const file=readFileSync(join(__dirname,'../app5.txt'),'utf8');
  const selectors=file.slice(file.indexOf(' const ruscheCloerDefaultId'),file.indexOf(' let manualDevices'));
  assert.ok(selectors.includes('function visibleEnergyDevices'));
  const net=async(url,{method='GET',body}={})=>{
    const q=new URL(url).searchParams;
    let rows=[];
    if(method==='GET')rows=[q.get('select')==='updated_at'?{updated_at:remote.updated_at}:structuredClone(remote)];
    if(method==='PATCH'&&q.get('updated_at')==='eq.'+remote.updated_at){remote=JSON.parse(body);rows=[{updated_at:remote.updated_at}]}
    return {ok:true,text:async()=>JSON.stringify(rows)};
  };
  const mem=[ [actual,separate], [actual,auto,separate], [auto,separate], [actual,separate] ].map(devices=>new Map([
    ['wm_backen_active_year',String(year)],['wm_backen_year_'+year,JSON.stringify({...fixture,energyConfig:{...fixture.energyConfig,devices}})]
  ]));
  const loadPhone=state=>{const p=phone(state,net);p(selectors+"\nARRAY_KEYS.push('energyConfig.devices');");return p};
  const visible=p=>JSON.parse(p("JSON.stringify(visibleEnergyDevices(s.energyConfig.devices).map(d=>[d.id,d.ironCount]))"));
  const expected=[[actual.id,5],[separate.id,2]].sort();
  assert.deepEqual(visible(loadPhone(mem[1])).sort(),expected,'old duplicate is already hidden offline');
  mem.forEach((m,i)=>add(loadPhone(m),'offline-cloer-'+i));
  const clients=mem.map(loadPhone);
  for(const p of clients)await p(`syncYear(${year})`);
  for(const p of clients)await p(`syncYear(${year})`);
  for(const p of clients)assert.deepEqual(visible(p).sort(),expected);
  const historical=remote.data.energyLogs.find(x=>x.id===sensitiveFields.id);
  for(const [k,value] of Object.entries(sensitiveFields))assert.equal(historical[k],value,k);
  assert.equal(remote.data.energyLogs.length,1);
  assert.equal(remote.data.purchaseEntries.length,backup.purchaseEntries.length+4);
  assert.ok(remote.data.energyConfig.devices.some(d=>d.id===auto.id),'stale default can remain in raw data but cannot reappear in the UI');
});

test('cent ledger keeps neutral expense, settlement, posted energy and odd loss separate',()=>{
 const p=phone(stored());
 const full=readFileSync(join(__dirname,'../app1.txt'),'utf8');
 p(full.slice(full.indexOf('const isLegacyPurchase='),full.indexOf('function shopHTML(')));
 const result=JSON.parse(p(`JSON.stringify(accountingFor({family1:'Römer',family2:'Rusche',purchaseEntries:[
  {buyerKey:'family1',total:25.44},{buyerKey:'family2',total:63.150000000000006},
  {buyerKey:'neutral',total:515.17},{buyerKey:'neutral',total:515,kind:'settlement',settlementFrom:'family1'}
 ],saleEntries:[{cookieQty:1,cookiePrice:50,reservationId:'synthetic'}],
 energyLogs:[{family:'Römer',cost:.335},{family:'Rusche',cost:.105}],
 energyConfig:{devices:[{running:true,startAt:1,watts:1000}]}}))`));
 assert.equal(result.revenueCents,5000);
 assert.equal(result.purchaseCents,60376);
 assert.equal(result.costs.neutral,51517);
 assert.deepEqual(result.energy,{family1:34,family2:11,unassigned:0});
 assert.equal(result.profitCents,-55421);
 assert.deepEqual([result.share1,result.share2],[-27710,-27711]);
 assert.deepEqual([result.expense1,result.expense2],[2578,6326]);
 assert.deepEqual([result.balance1,result.balance2],[26368,-72885]);
});
test('stale or later edited copy does not resurrect a deleted purchase',()=>{
 const p=phone(stored());const remote={...backup,purchaseEntries:[],_sync:{tombstones:{purchaseEntries:{existing:'2026-11-20T12:00:00Z'}}}};
 const stale={...backup,purchaseEntries:[{...backup.purchaseEntries[0],_updatedAt:'2026-11-25T12:00:00Z'}]};
 assert.equal(p(`mergeStates(${JSON.stringify(stale)},${JSON.stringify(remote)},2026,'2026-11-20T12:00:00Z').purchaseEntries.length`),0);
});
test('six-week-old local purchase edit survives restart, API rejection and delete conflict',async()=>{
 const data=stored();
 const stamp='2026-11-25T00:00:00Z';
 const remote={...backup,purchaseEntries:[],_sync:{tombstones:{purchaseEntries:{existing:stamp}}}};
 let available=false;
 const net=async(url,{method='GET'}={})=>{
   assert.equal(method,'GET','conflict must not overwrite the cloud');
   if(!available)return {ok:false,status:503,text:async()=>'unavailable'};
   return {ok:true,text:async()=>JSON.stringify([new URL(url).searchParams.get('select')==='updated_at'?{updated_at:stamp}:{data:remote,updated_at:stamp}])};
 };
 const old=phone(data,net);old("s.purchaseEntries[0].total=7;save()");
 const journalKey='wm_backen_journal_v1_'+year, journal=JSON.parse(data.get(journalKey));
 journal.details[journal.pending[0]].at='2026-10-14T00:00:00Z';data.set(journalKey,JSON.stringify(journal));
 const latest=phone(data,net);
 await assert.rejects(latest(`syncYear(${year})`),/Cloud 503/);
 assert.equal(phone(data,net)("s.purchaseEntries[0].total"),7);
 available=true;
 assert.equal(await latest(`syncYear(${year})`),'conflict');
 const saved=JSON.parse(data.get(journalKey));
 assert.equal(saved.conflict.code,'WM_PURCHASE_DELETED');
 assert.equal(saved.pending.length,1);
 assert.equal(saved.state.purchaseEntries[0].receiptPhoto,'synthetic-photo-fixture');
 assert.equal(saved.details[saved.pending[0]].at,'2026-10-14T00:00:00Z');
});

test('successful cloud reads report contact; errors do not claim a confirmed revision',async()=>{
 let okay=false;const stamp='2026-11-20T12:00:00Z';
 const net=async(url)=>({ok:okay,status:503,text:async()=>okay?JSON.stringify([new URL(url).searchParams.get('select')==='updated_at'?{updated_at:stamp}:{data:backup,updated_at:stamp}]):'unavailable'});
 const mem=stored(),p=phone(mem,net);
 await assert.rejects(p('getCloudStamp(2026)'),/503/);
 assert.equal(p('deviceDiagnostics.lastConfirmedAt'),undefined);
 okay=true;
 assert.equal(await p('getCloudStamp(2026)'),stamp);
 assert.ok(p('deviceDiagnostics.lastContactAt'));
 assert.equal(p('deviceDiagnostics.lastConfirmedAt'),undefined);
});
