-- Install only after the release checks pass. Replace __WM_WORKSPACE_UUID__ with
-- the verified workspace UUID; an unrendered template fails its UUID cast.
begin;

create schema if not exists wm_internal;
revoke all on schema wm_internal from public;

create or replace function wm_internal.stock_quantity(value jsonb)
returns numeric
language plpgsql immutable security invoker
set search_path = pg_catalog
as $$
declare quantity numeric;
begin
  if value is null or value = 'null'::jsonb then return 0; end if;
  if jsonb_typeof(value) not in ('number', 'string') or (value #>> '{}') !~ '^[0-9]{1,16}(\.0+)?$' then
    raise exception using errcode = '23514', message = 'WM_STOCK_INVALID_QUANTITY';
  end if;
  quantity := (value #>> '{}')::numeric;
  if quantity > 9007199254740991 then
    raise exception using errcode = '23514', message = 'WM_STOCK_INVALID_QUANTITY';
  end if;
  return quantity;
end $$;

create or replace function wm_internal.guard_app_stock()
returns trigger
language plpgsql security invoker
set search_path = pg_catalog
as $$
declare
  old_data jsonb := '{}'::jsonb;
  product text;
  available numeric;
begin
  if tg_op = 'UPDATE' then old_data := old.data; end if;
  -- Untouched V10.5.4 years remain byte-compatible until reservations are enabled.
  if not (new.data ? 'reservations') and not (old_data ? 'reservations') then return new; end if;
  if jsonb_typeof(new.data->'reservations') is distinct from 'array'
     or jsonb_typeof(new.data->'saleEntries') is distinct from 'array'
     or jsonb_typeof(new.data->'production') is distinct from 'object' then
    raise exception using errcode = '23514', message = 'WM_STOCK_INVALID_SHAPE';
  end if;

  if exists (
    select 1 from jsonb_array_elements(new.data->'reservations') as r(doc)
    where jsonb_typeof(r.doc->'open') is distinct from 'object'
      or jsonb_typeof(r.doc->'audit') is distinct from 'array'
      or jsonb_typeof(r.doc->'pickups') is distinct from 'array'
      or coalesce(r.doc->>'id','') = ''
  ) or exists (
    select 1 from jsonb_array_elements(new.data->'reservations') as r(doc)
    group by r.doc->>'id' having count(*) > 1
  ) then
    raise exception using errcode = '23514', message = 'WM_STOCK_INVALID_RESERVATION';
  end if;
  -- Stale snapshots may neither erase confirmed reservations nor rewrite their audit prefix.
  if exists (
    select 1 from jsonb_array_elements(coalesce(old_data->'reservations','[]'::jsonb)) as prior(doc)
    left join lateral (
      select r.doc from jsonb_array_elements(new.data->'reservations') as r(doc)
      where r.doc->>'id' = prior.doc->>'id'
    ) next on true
    where next.doc is null
       or (next.doc is distinct from prior.doc and jsonb_array_length(next.doc->'audit') <= jsonb_array_length(prior.doc->'audit'))
       or exists (
         select 1 from jsonb_array_elements(prior.doc->'audit') with ordinality as event(doc, position)
         where event.doc is distinct from (next.doc->'audit'->((event.position - 1)::integer))
       )
  ) then
    raise exception using errcode = '23514', message = 'WM_STOCK_STALE_RESERVATION';
  end if;

  -- A confirmed pickup has exactly one matching sale. A reversed pickup has
  -- none. Reject unpaired reservation sales, including stale resurrection.
  if exists (
    with pickups as (
      select r.doc->>'id' as reservation_id, p.doc as pickup
      from jsonb_array_elements(new.data->'reservations') as r(doc)
      cross join lateral jsonb_array_elements(r.doc->'pickups') as p(doc)
    ), sales as (
      select e.doc as sale
      from jsonb_array_elements(new.data->'saleEntries') as e(doc)
      where e.doc ? 'reservationId'
    )
    select 1 from pickups p
    where coalesce(p.pickup->>'saleId','') = ''
       or (select count(*) from sales e where e.sale->>'id' = p.pickup->>'saleId')
            <> case when p.pickup->>'voidedAt' is null then 1 else 0 end
    union all
    select 1 from sales e where (
      select count(*) from pickups p
      where p.pickup->>'voidedAt' is null
        and p.reservation_id = e.sale->>'reservationId'
        and p.pickup->>'saleId' = e.sale->>'id'
        and not exists (
          select 1 from unnest(array['cookie','horn','mixed']) as k(name)
          where wm_internal.stock_quantity(e.sale->(k.name||'Qty'))
                  <> wm_internal.stock_quantity(p.pickup->'quantities'->k.name)
             or (e.sale->>(k.name||'Price'))::numeric * 100 is distinct from
                  wm_internal.stock_quantity(p.pickup->'priceCents'->k.name)
        )
    ) <> 1
  ) then
    raise exception using errcode = '23514', message = 'WM_STOCK_PICKUP_SALE_MISMATCH';
  end if;
  -- The table update locks this workspace/year row. Check the resulting combined
  -- state here, not before the write and not in a separate API request.
  foreach product in array array['cookie','horn','mixed'] loop
    available := wm_internal.stock_quantity(new.data->'production'->product)
       - coalesce((select sum(wm_internal.stock_quantity(e.doc->(product||'Qty')))
                   from jsonb_array_elements(new.data->'saleEntries') as e(doc)),0)
       - coalesce((select sum(wm_internal.stock_quantity(r.doc->'open'->product))
                   from jsonb_array_elements(new.data->'reservations') as r(doc)),0);
    if available < 0 then
      raise exception using errcode = '23514', message = 'WM_STOCK_INSUFFICIENT', detail = product;
    end if;
  end loop;
  if tg_op = 'UPDATE' then
    new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  end if;
  return new;
end $$;

-- Trigger execution and helper calls remain invoker-scoped. No tables or RPCs
-- become accessible to API roles via this proposal.
revoke all on function wm_internal.guard_app_stock() from public;
revoke all on function wm_internal.stock_quantity(jsonb) from public;
grant usage on schema wm_internal to anon, authenticated, service_role;
grant execute on function wm_internal.stock_quantity(jsonb) to anon, authenticated, service_role;
drop trigger if exists wm_guard_app_stock on public.app_state;
create trigger wm_guard_app_stock
before insert or update of data on public.app_state
for each row when (new.workspace_id = '__WM_WORKSPACE_UUID__'::uuid)
execute function wm_internal.guard_app_stock();
commit;
