// Requires PostgreSQL 17 binaries (WM_PG_BIN) and pg@8.16.3.
// Creates a private, socket-only test instance. Never reads a live connection URL.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtempSync,readFileSync,rmSync}=require('node:fs');
const {execFileSync,spawn}=require('node:child_process');
const {once}=require('node:events');
const {join}=require('node:path');
const {tmpdir,userInfo}=require('node:os');
const {setTimeout:delay}=require('node:timers/promises');
const {Client}=require('pg');
const reservations=require('../reservations.js');
const workspace='00000000-0000-4000-8000-000000000001';
const proposal=readFileSync(join(__dirname,'../db-proposals/issue-5-stock-guard.sql'),'utf8').replace('__WM_WORKSPACE_UUID__',workspace);
const q={cookie:1,horn:0,mixed:0};
const fixture={production:q,saleEntries:[],reservations:[]};
const hold={id:'first',reservationId:'r1',type:'create',date:'2026-11-19',at:'2026-11-19T12:00Z',name:'Test',quantities:q};
const reserve=reservations.apply(fixture,hold);
const other=reservations.apply(fixture,{...hold,id:'second',reservationId:'r2'});
const sale={id:'sale-last',cookieQty:1,cookiePrice:9};

test('two PostgreSQL sessions contend for the last bucket', {timeout:30000}, async()=>{
 const bin=process.env.WM_PG_BIN;
 assert.ok(bin,'Set WM_PG_BIN to the PostgreSQL bin directory.');
 const directory=mkdtempSync(join(tmpdir(),'wm-stock-native-'));
 const client=(application_name)=>new Client({host:directory,port:5432,user:userInfo().username,password:'',database:'postgres',application_name,connectionTimeoutMillis:1000,statement_timeout:7000});
 let server,a,b;
 try {
  execFileSync(join(bin,'initdb'),['-D',join(directory,'data'),'--no-locale','--encoding=UTF8','--auth=trust'],{stdio:'pipe'});
  server=spawn(join(bin,'postgres'),['-D',join(directory,'data'),'-h','','-k',directory],{stdio:'ignore'});
  for(let i=0;i<80;i++){
    a=client('wm-stock-winner');
    try{await a.connect();break}catch(error){await a.end();a=null;if(i===79||error.code==='EPERM'||error.code==='EACCES')throw error;await delay(50)}
  }
  b=client('wm-stock-waiter');await b.connect();
  await a.query(`create role anon; create role authenticated; create role service_role;
    create table public.app_state(workspace_id uuid, year int, data jsonb not null, updated_at timestamptz not null default now(), primary key(workspace_id,year));`);
  await a.query(proposal);
  const pickupOp={...hold,type:'pickup',id:'pickup-once',revision:1,priceCents:{cookie:1200,horn:0,mixed:0}};
  const picked=reservations.apply(reserve,pickupOp);
  const openTwo={...reserve,production:{cookie:2,horn:0,mixed:0}};
  const pickedTwo=reservations.apply(openTwo,pickupOp);
  const scenarios=[
    ['two reservations of the last bucket',fixture,reserve,other,s=>({...s,reservations:[...s.reservations,...other.reservations]}),/WM_STOCK_INSUFFICIENT/],
    ['reservation versus direct sale',fixture,reserve,{...fixture,saleEntries:[sale]},s=>({...s,saleEntries:[sale]}),/WM_STOCK_INSUFFICIENT/],
    ['reservation versus production correction',fixture,reserve,{...fixture,production:{...q,cookie:0}},s=>({...s,production:{...q,cookie:0}}),/WM_STOCK_INSUFFICIENT/],
    ['pickup versus direct sale of reserved stock',reserve,picked,{...reserve,saleEntries:[sale]},s=>({...s,saleEntries:[...s.saleEntries,sale]}),/WM_STOCK_INSUFFICIENT/],
    ['pickup and direct sale of a separate free bucket',openTwo,pickedTwo,{...openTwo,saleEntries:[sale]},s=>({...s,saleEntries:[...s.saleEntries,sale]}),null]
  ];
  for(const [i,[name,initial,winner,loser,retry,rejection]] of scenarios.entries()){
    const year=2026+i;
    const read=async()=>(await a.query('select data,updated_at::text as stamp from public.app_state where workspace_id=$1 and year=$2',[workspace,year])).rows[0];
    const update=(c,state,stamp)=>c.query('update public.app_state set data=$1 where workspace_id=$2 and year=$4 and updated_at=$3 returning data',[state,workspace,stamp,year]);
    await a.query('insert into public.app_state(workspace_id,year,data) values($1,$2,$3)',[workspace,year,initial]);
    const before=await read();assert.deepEqual(before.data,initial);
    await a.query('begin');
    await update(a,winner,before.stamp);
    const waiting=update(b,loser,before.stamp).then(result=>({result}),error=>({error}));
    let didWait=false;
    for(let j=0;j<40;j++){
      const state=await a.query("select wait_event_type from pg_stat_activity where application_name='wm-stock-waiter'");
      if(state.rows[0]?.wait_event_type==='Lock'){didWait=true;break}
      await delay(25);
    }
    await a.query('commit');
    assert.equal(didWait,true,name);
    const result=await waiting;assert.ifError(result.error);
    assert.equal(result.result.rowCount,0,name);
    const latest=await read();assert.notEqual(latest.stamp,before.stamp);
    if(rejection){await assert.rejects(update(b,retry(latest.data),latest.stamp),rejection);assert.deepEqual((await read()).data,winner)}
    else await update(b,retry(latest.data),latest.stamp);
    const after=await read();
    assert.ok(Object.values(reservations.remainingStock(after.data)).every(x=>x>=0));
    assert.equal(new Set(after.data.saleEntries.map(x=>x.id)).size,after.data.saleEntries.length);
    if(i>=3){
      assert.deepEqual(reservations.apply(after.data,pickupOp),after.data);
      const revenue=after.data.saleEntries.reduce((n,x)=>n+x.cookieQty*x.cookiePrice,0);
      assert.equal(revenue,i===3?12:21);
    }
    console.log('Verified real PostgreSQL lock and final state:',name);
  }
 } finally {
  if(a)await a.end();
  if(b)await b.end();
  if(server&&server.exitCode===null&&server.signalCode===null){const exited=once(server,'exit');server.kill('SIGINT');await exited}
  rmSync(directory,{recursive:true,force:true});
 }
});
