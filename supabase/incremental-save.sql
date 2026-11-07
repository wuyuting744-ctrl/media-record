-- Run once in the existing project's SQL Editor. Existing records/images are retained.
create or replace function public.media_save_delta(p_revision bigint, p_changes jsonb)
returns table(revision bigint, updated_at timestamptz)
language plpgsql security invoker set search_path=public as $$
declare
 account public.media_account_data%rowtype;
 items jsonb; item jsonb; position integer;
begin
 if auth.uid() is null then raise exception 'Login required'; end if;
 if octet_length(p_changes::text)>25000000 then raise exception '保存请求超过25MB'; end if;
 select * into account from public.media_account_data a where a.user_id=auth.uid() for update;
 if not found or account.revision<>p_revision then raise exception '版本冲突，请刷新云端资料后重试'; end if;
 items=account.records;
 if p_changes ? 'deleted' then
  select coalesce(jsonb_agg(r.value order by r.ordinality),'[]'::jsonb) into items
  from jsonb_array_elements(items) with ordinality r
  where not (p_changes->'deleted' ? (r.value->>'id'));
 end if;
 for item in select value from jsonb_array_elements(coalesce(p_changes->'upsert','[]'::jsonb)) loop
  if coalesce(item->>'id','')='' or coalesce(item->>'title','')='' then raise exception '记录不完整'; end if;
  if item ? 'coverPath' and item->>'coverPath' not like auth.uid()::text||'/%' then raise exception 'Invalid cover owner'; end if;
  select (r.ordinality-1)::integer into position from jsonb_array_elements(items) with ordinality r where r.value->>'id'=item->>'id';
  if position is null then items=jsonb_build_array(item)||items;
  else items=jsonb_set(items,array[position::text],item); end if;
 end loop;
 if p_changes ? 'order' then
  select coalesce(jsonb_agg(r.value order by coalesce(o.ordinality,2147483647),r.ordinality),'[]'::jsonb) into items
  from jsonb_array_elements(items) with ordinality r
  left join jsonb_array_elements_text(p_changes->'order') with ordinality o on o.value=r.value->>'id';
 end if;
 update public.media_account_data a set
  records=items,
  images=(a.images||coalesce(p_changes->'images','{}'::jsonb))-array(select jsonb_array_elements_text(coalesce(p_changes->'deletedImages','[]'::jsonb))),
  genres=coalesce(p_changes->'genres',a.genres), companions=coalesce(p_changes->'companions',a.companions),
  layout=coalesce(p_changes->'layout',a.layout),revision=a.revision+1,updated_at=now()
 where a.user_id=auth.uid() returning a.revision,a.updated_at into revision,updated_at;
 return next;
end $$;
revoke all on function public.media_save_delta(bigint,jsonb) from public,anon;
grant execute on function public.media_save_delta(bigint,jsonb) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('media-covers','media-covers',false,2097152,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;
drop policy if exists media_cover_read on storage.objects;
create policy media_cover_read on storage.objects for select to authenticated
using (bucket_id='media-covers' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists media_cover_insert on storage.objects;
create policy media_cover_insert on storage.objects for insert to authenticated
with check (bucket_id='media-covers' and (storage.foldername(name))[1]=(select auth.uid())::text);
notify pgrst,'reload schema';
