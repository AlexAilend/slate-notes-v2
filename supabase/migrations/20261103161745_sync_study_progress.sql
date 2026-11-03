
create table public.study_progress (
 user_id uuid not null references public.profiles(id) on delete cascade,
 bank_id text not null check (length(bank_id) between 1 and 100),
 snapshot jsonb not null check (jsonb_typeof(snapshot)='object' and octet_length(snapshot::text)<1048576),
 revision bigint not null default 1,
 updated_at timestamptz not null default now(),
 primary key(user_id,bank_id)
);
alter table public.study_progress enable row level security;
revoke all on public.study_progress from public,anon,authenticated;
grant select,insert,update on public.study_progress to authenticated;
create policy study_read on public.study_progress for select to authenticated using (user_id=(select auth.uid()) and private.actor_role() is not null);
create policy study_insert on public.study_progress for insert to authenticated with check(user_id=(select auth.uid()) and private.actor_role() is not null);
create policy study_update on public.study_progress for update to authenticated using(user_id=(select auth.uid()) and private.actor_role() is not null) with check(user_id=(select auth.uid()) and private.actor_role() is not null);
create function public.save_study_progress(p_bank_id text,p_snapshot jsonb,p_revision bigint)
returns setof public.study_progress
language sql security invoker set search_path='' as $$
 insert into public.study_progress as current(user_id,bank_id,snapshot,revision,updated_at)
 values(auth.uid(),p_bank_id,p_snapshot,1,clock_timestamp())
 on conflict(user_id,bank_id) do update
 set snapshot=excluded.snapshot,revision=current.revision+1,updated_at=clock_timestamp()
 where current.revision=p_revision
 returning current.*;
$$;
revoke all on function public.save_study_progress(text,jsonb,bigint) from public,anon;
grant execute on function public.save_study_progress(text,jsonb,bigint) to authenticated;
