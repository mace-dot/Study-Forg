-- Dedicated StudyForge schema; do not apply this to an unrelated app's project.
create table public.studyforge_records (
 owner_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check (kind in ('course','material','pack','job','session','attempt')),
 id uuid not null,
 payload jsonb not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 primary key (owner_id,kind,id)
);
create index studyforge_records_owner_kind on public.studyforge_records(owner_id,kind,created_at);
alter table public.studyforge_records enable row level security;
-- All mutations are performed by authenticated server routes. Sessions contain
-- answer keys, so clients cannot SELECT them directly, even for their own user.
revoke all on public.studyforge_records from anon, authenticated;
grant select on public.studyforge_records to authenticated;
grant all on public.studyforge_records to service_role;
create policy "Read own study records excluding answer keys" on public.studyforge_records
 for select to authenticated using ((select auth.uid())=owner_id and kind<>'session');
create schema if not exists studyforge_private;
revoke all on schema studyforge_private from public,anon,authenticated;
grant usage on schema studyforge_private to service_role;
create table studyforge_private.locks(owner_id uuid not null, lock_key text not null, expires_at timestamptz not null,primary key(owner_id,lock_key));
grant all on studyforge_private.locks to service_role;
alter table studyforge_private.locks enable row level security;
-- Invoker functions: only the service role has access to the private lock table.
create function public.studyforge_claim_lock(p_owner uuid,p_key text) returns boolean language plpgsql security invoker set search_path='' as $$
declare acquired boolean;
begin
 insert into studyforge_private.locks(owner_id,lock_key,expires_at) values(p_owner,p_key,now()+interval '180 seconds')
 on conflict(owner_id,lock_key) do update set expires_at=excluded.expires_at
 where studyforge_private.locks.expires_at<now() returning true into acquired;
 return coalesce(acquired,false);
end;$$;
create function public.studyforge_release_lock(p_owner uuid,p_key text) returns void language sql security invoker set search_path='' as $$delete from studyforge_private.locks where owner_id=p_owner and lock_key=p_key;$$;
revoke all on function public.studyforge_claim_lock(uuid,text),public.studyforge_release_lock(uuid,text) from public,anon,authenticated;
grant execute on function public.studyforge_claim_lock(uuid,text),public.studyforge_release_lock(uuid,text) to service_role;
insert into storage.buckets(id,name,public,file_size_limit) values('studyforge-materials','studyforge-materials',false,3500000) on conflict(id) do nothing;
-- No public Storage policies. Authorized server routes serve originals after ownership checks.
