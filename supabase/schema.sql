create table if not exists public.media_account_data (
 user_id uuid primary key references auth.users(id) on delete cascade,
 records jsonb not null default '[]', images jsonb not null default '{}',
 genres jsonb not null default '[]', companions jsonb not null default '[]',
 layout jsonb not null default '[]', revision bigint not null default 0,
 updated_at timestamptz not null default now(),
 check(jsonb_typeof(records)='array' and jsonb_typeof(images)='object' and jsonb_typeof(genres)='array' and jsonb_typeof(companions)='array' and jsonb_typeof(layout)='array')
);
alter table public.media_account_data enable row level security;
revoke all on public.media_account_data from anon, authenticated;
grant select,insert,update on public.media_account_data to authenticated;
create policy media_owner_read on public.media_account_data for select to authenticated using ((select auth.uid())=user_id);
create policy media_owner_insert on public.media_account_data for insert to authenticated with check ((select auth.uid())=user_id);
create policy media_owner_update on public.media_account_data for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create or replace function public.media_save(p_revision bigint,p_data jsonb)
returns setof public.media_account_data language plpgsql security invoker set search_path=public as $$
begin
 if auth.uid() is null then raise exception 'Login required'; end if;
 if octet_length(p_data::text)>25000000 then raise exception '资料超过 25MB，请缩减封面图片'; end if;
 return query update public.media_account_data set records=p_data->'records',images=p_data->'images',genres=p_data->'genres',companions=p_data->'companions',layout=p_data->'layout',revision=revision+1,updated_at=now() where user_id=auth.uid() and revision=p_revision returning *;
 if not found then raise exception '版本冲突，请刷新云端资料后重试'; end if;
end $$;
revoke all on function public.media_save(bigint,jsonb) from public,anon;
grant execute on function public.media_save(bigint,jsonb) to authenticated;

