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
const proposal=readFileSync(join(__dirname,'../db-proposals/issue-5-stock-guard.sql'),'utf8');
const workspace='00000000-0000-4000-8000-000000000001';
const q={cookie:1,horn:0,mixed:0};
const fixture={production:q,saleEntries:[],reservations:[]};
const reserve=reservations.apply(fixture,{id:'first',reservationId:'r1',type:'create',date:'2026-11-19',at:'2026-11-19T12:00Z',name:'Test',quantities:q});
const sale={id:'sale-last',cookieQty:1};

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
  const read=async()=>(await a.query('select data,updated_at::text as stamp from public.app_state where workspace_id=$1 and year=2026',[workspace])).rows[0];
  const update=(c,state,stamp)=>c.query('update public.app_state set data=$1 where workspace_id=$2 and year=2026 and updated_at=$3 returning data',[state,workspace,stamp]);
  await a.query('insert into public.app_state(workspace_id,year,data) values($1,2026,$2)',[workspace,fixture]);
  const {stamp}=await read();
  await a.query('begin');
  await update(a,reserve,stamp);
  const waiting=update(b,{...fixture,saleEntries:[sale]},stamp).then(result=>({result}),error=>({error}));
  let didWait=false;
  for(let i=0;i<40;i++){
    const state=await a.query("select wait_event_type from pg_stat_activity where application_name='wm-stock-waiter'");
    if(state.rows[0]?.wait_event_type==='Lock'){didWait=true;break}
    await delay(25);
  }
  await a.query('commit');
  assert.equal(didWait,true);
  const result=await waiting;
  assert.ifError(result.error);
  assert.equal(result.result.rowCount,0,'stale write is discarded by compare-and-swap');
  const latest=await read();
  assert.notEqual(latest.stamp,stamp);
  await assert.rejects(update(b,{...latest.data,saleEntries:[sale]},latest.stamp),/WM_STOCK_INSUFFICIENT/);
  assert.deepEqual((await read()).data,reserve);
 } finally {
  if(a)await a.end();
  if(b)await b.end();
  if(server&&server.exitCode===null&&server.signalCode===null){const exited=once(server,'exit');server.kill('SIGINT');await exited}
  rmSync(directory,{recursive:true,force:true});
 }
});
