create table private.owner_identity(email text primary key);
revoke all on private.owner_identity from public,anon,authenticated;
create function private.provision_owner() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.email_confirmed_at is not null and exists(select 1 from private.owner_identity where lower(email)=lower(new.email)) then
  update public.profiles set role='admin' where id=new.id;
 end if;
 return new;
end; $$;
revoke all on function private.provision_owner() from public,anon,authenticated;
create trigger slate_confirmed_owner after update of email_confirmed_at on auth.users for each row execute function private.provision_owner();
