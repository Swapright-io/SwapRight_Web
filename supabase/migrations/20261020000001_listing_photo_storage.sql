insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'listing-photos',
  'listing-photos',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists listing_photos_storage_insert_own_folder on storage.objects;
drop policy if exists listing_photos_storage_update_own_folder on storage.objects;
drop policy if exists listing_photos_storage_delete_own_folder on storage.objects;

create policy listing_photos_storage_insert_own_folder
on storage.objects for insert to authenticated
with check (
  bucket_id = 'listing-photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy listing_photos_storage_update_own_folder
on storage.objects for update to authenticated
using (
  bucket_id = 'listing-photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
)
with check (
  bucket_id = 'listing-photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy listing_photos_storage_delete_own_folder
on storage.objects for delete to authenticated
using (
  bucket_id = 'listing-photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists listing_photos_insert_own on public.listing_photos;
create policy listing_photos_insert_own
on public.listing_photos for insert to authenticated
with check (
  owner_id = (select auth.uid())
  and exists (
    select 1 from public.listings l
    where l.id = listing_id and l.owner_id = (select auth.uid())
  )
);
