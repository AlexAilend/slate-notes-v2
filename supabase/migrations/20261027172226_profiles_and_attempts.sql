create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 email text not null, display_name text not null default '',
 role text not null default 'user' check(role in ('user','admin')),
 created_at timestamptz not null default now(), last_seen_at timestamptz,
 active boolean not null default true
);
alter table public.profiles enable row level security;
create function private.actor_role() returns text language sql stable security definer set search_path = '' as $$
 select role from public.profiles where id = (select auth.uid()) and active;
$$;
revoke all on function private.actor_role() from public, anon;
grant execute on function private.actor_role() to authenticated;
create function private.new_profile() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 insert into public.profiles(id,email) values(new.id,coalesce(new.email,'')); return new;
end; $$;
revoke all on function private.new_profile() from public, anon, authenticated;
create trigger slate_profile_created after insert on auth.users for each row execute function private.new_profile();
insert into public.profiles(id,email) select id,coalesce(email,'') from auth.users on conflict do nothing;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update(display_name,last_seen_at) on public.profiles to authenticated;
create policy profile_read on public.profiles for select to authenticated using (
 private.actor_role() is not null and (id=(select auth.uid()) or private.actor_role()='admin'));
create policy profile_update on public.profiles for update to authenticated
 using(id=(select auth.uid()) and private.actor_role() is not null)
 with check(id=(select auth.uid()) and private.actor_role() is not null);
create table public.exam_attempts (
 id uuid primary key, user_id uuid not null references public.profiles(id),
 bank_id text not null, mode text not null check(mode in ('exam','practice')),
 started_at timestamptz not null, finished_at timestamptz,
 total_questions integer not null check(total_questions>0), correct_answers integer not null default 0,
 wrong_answers integer not null default 0, score_percent numeric not null default 0 check(score_percent between 0 and 100),
 duration_seconds integer not null default 0 check(duration_seconds>=0),
 shuffle_questions boolean not null, shuffle_answers boolean not null,
 snapshot jsonb not null,
 unique(id,user_id), check(correct_answers>=0 and wrong_answers>=0 and correct_answers+wrong_answers<=total_questions)
);
create table public.exam_answers (
 id uuid primary key default gen_random_uuid(), attempt_id uuid not null, user_id uuid not null,
 question_id integer not null, question_order integer not null check(question_order>=0),
 selected_answers jsonb not null, correct_answers jsonb not null, is_correct boolean not null,
 option_order jsonb not null, question_snapshot jsonb not null,
 foreign key(attempt_id,user_id) references public.exam_attempts(id,user_id) on delete cascade,
 unique(attempt_id,question_id), unique(attempt_id,question_order)
);
create index exam_attempts_user on public.exam_attempts(user_id,finished_at desc);
create index exam_answers_user on public.exam_answers(user_id);
alter table public.exam_attempts enable row level security;
alter table public.exam_answers enable row level security;
revoke all on public.exam_attempts, public.exam_answers from anon,authenticated;
grant select,insert,update on public.exam_attempts to authenticated;
grant select,insert on public.exam_answers to authenticated;
create policy attempts_read on public.exam_attempts for select to authenticated using(private.actor_role() is not null and (user_id=(select auth.uid()) or private.actor_role()='admin'));
create policy attempts_insert on public.exam_attempts for insert to authenticated with check(user_id=(select auth.uid()) and private.actor_role() is not null);
create policy attempts_update on public.exam_attempts for update to authenticated using(user_id=(select auth.uid()) and private.actor_role() is not null and finished_at is null) with check(user_id=(select auth.uid()) and private.actor_role() is not null);
create policy answers_read on public.exam_answers for select to authenticated using(private.actor_role() is not null and (user_id=(select auth.uid()) or private.actor_role()='admin'));
create policy answers_insert on public.exam_answers for insert to authenticated with check(user_id=(select auth.uid()) and private.actor_role() is not null and exists(select 1 from public.exam_attempts a where a.id=attempt_id and a.user_id=(select auth.uid()) and a.finished_at is null));
-- Atomic finish: ownership is enforced by RLS and the function runs as the caller.
create function public.finish_exam(p_id uuid,p_snapshot jsonb,p_answers jsonb,p_correct integer,p_score numeric,p_duration integer)
returns void language plpgsql security invoker set search_path='' as $$
declare a public.exam_attempts;
begin
 select * into a from public.exam_attempts where id=p_id and user_id=auth.uid() for update;
 if not found then raise exception 'Attempt unavailable'; end if;
 if a.finished_at is not null then return; end if;
 if jsonb_array_length(p_answers)<>a.total_questions then raise exception 'Incomplete answer records'; end if;
 insert into public.exam_answers(attempt_id,user_id,question_id,question_order,selected_answers,correct_answers,is_correct,option_order,question_snapshot)
 select p_id,auth.uid(),(x->>'question_id')::integer,(x->>'question_order')::integer,x->'selected_answers',x->'correct_answers',(x->>'is_correct')::boolean,x->'option_order',x->'question_snapshot'
 from jsonb_array_elements(p_answers) x;
 update public.exam_attempts set finished_at=now(),correct_answers=p_correct,wrong_answers=total_questions-p_correct,score_percent=p_score,duration_seconds=p_duration,snapshot=p_snapshot where id=p_id and user_id=auth.uid();
end; $$;
revoke all on function public.finish_exam(uuid,jsonb,jsonb,integer,numeric,integer) from public,anon;
grant execute on function public.finish_exam(uuid,jsonb,jsonb,integer,numeric,integer) to authenticated;
