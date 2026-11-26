// Run against disposable PGlite only; this test accepts no database URL.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const reservations=require('../reservations.js');
const q=(cookie=0,horn=0,mixed=0)=>({cookie,horn,mixed});
const start={production:q(1),saleEntries:[],reservations:[]};
const op=(type,id,details={})=>({type,id,reservationId:'r1',at:'2026-11-19T12:00Z',...details});
const hold=reservations.apply(start,op('create','c',{name:'Test',date:'2026-11-19',quantities:q(1)}));
const sale={id:'direct',cookieQty:1,hornQty:0,mixedQty:0};
const workspace='00000000-0000-4000-8000-000000000001';
const proposal=readFileSync(join(__dirname,'../db-proposals/issue-5-stock-guard.sql'),'utf8').replace('__WM_WORKSPACE_UUID__',workspace);

test('Stock trigger applies inside the row write without changing workspace permissions',async()=>{
 const db=new PGlite();
 try {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table public.app_state(workspace_id uuid, year int, data jsonb not null, updated_at timestamptz not null default now(), primary key(workspace_id,year));
    alter table public.app_state enable row level security;
    grant select, insert, update on public.app_state to anon;
    create policy test_workspace on public.app_state for all to anon
     using(workspace_id::text = current_setting('wm.test_workspace')) with check(workspace_id::text = current_setting('wm.test_workspace'));`);
  await db.exec(proposal);
  await db.exec(`set role anon; set wm.test_workspace = '${workspace}';`);
  const put=(data,stamp=null)=>db.query(`update public.app_state set data=$1 where year=2026 and ($2::timestamptz is null or updated_at=$2::timestamptz) returning data,updated_at::text as stamp`,[data,stamp]);
  const get=async()=>(await db.query('select data,updated_at::text as stamp from public.app_state where year=2026')).rows[0];
  const insert=(year,data)=>db.query('insert into public.app_state(workspace_id,year,data) values($1,$2,$3)',[workspace,year,data]);
  await insert(2025,{production:q(),saleEntries:[sale],historical:true});
  await insert(2026,start);
  const revision=(await get()).stamp;
  await put(hold,revision);
  assert.equal((await put({...start,saleEntries:[sale]},revision)).rows.length,0,'stale conditional write does not run');
  await assert.rejects(put({...hold,saleEntries:[sale]}),/WM_STOCK_INSUFFICIENT/);
  await assert.rejects(put({...hold,production:q()}),/WM_STOCK_INSUFFICIENT/);
  await assert.rejects(put({production:q(1),saleEntries:[]}),/WM_STOCK_INVALID_SHAPE/);
  await assert.rejects(put(start),/WM_STOCK_STALE_RESERVATION/);
  const pickup=reservations.apply(hold,op('pickup','p',{revision:1,quantities:q(1),priceCents:q(1299)}));
  await put(pickup);
  await assert.rejects(put({...pickup,saleEntries:[]}),/WM_STOCK_PICKUP_SALE_MISMATCH/);
  await assert.rejects(put({...pickup,saleEntries:[{...pickup.saleEntries[0],cookiePrice:10}]}),/WM_STOCK_PICKUP_SALE_MISMATCH/);
  const reverse=reservations.apply(pickup,op('reverse','x',{revision:2,pickupId:'p',reason:'Test'}));
  await put(reverse);
  await assert.rejects(put({...reverse,saleEntries:pickup.saleEntries}),/WM_STOCK_PICKUP_SALE_MISMATCH/);
  assert.deepEqual((await get()).data,reverse);
  await assert.rejects(insert(2027,{...start,saleEntries:[sale,sale]}),/WM_STOCK_INSUFFICIENT/);
  await db.exec("set wm.test_workspace = '00000000-0000-4000-8000-000000000002'");
  assert.equal(await get(),undefined,'no expanded workspace visibility');
  assert.equal((await put(hold)).rows.length,0);
  const unrelatedData={...start,saleEntries:[sale,sale]};
  const unrelated=await db.query('insert into public.app_state(workspace_id,year,data) values($1,$2,$3) returning data',['00000000-0000-4000-8000-000000000002',2026,unrelatedData]);
  assert.deepEqual(unrelated.rows[0].data,unrelatedData,'guard proposal leaves unrelated workspaces untouched');
 } finally {await db.close()}
});
