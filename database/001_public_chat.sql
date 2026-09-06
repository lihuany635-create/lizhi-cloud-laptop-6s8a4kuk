-- A new, intentionally public chat only. Existing private tables are untouched.
begin;
create table public.lizhi_cloud_messages (
  id uuid primary key,
  device_id uuid not null,
  device_name text not null check (char_length(device_name) between 1 and 40),
  content text not null check (char_length(content) between 1 and 10000),
  created_at timestamptz not null default clock_timestamp()
);
create index lizhi_cloud_messages_created on public.lizhi_cloud_messages(created_at desc, id desc);
alter table public.lizhi_cloud_messages enable row level security;
revoke all on public.lizhi_cloud_messages from public, anon, authenticated;
grant select on public.lizhi_cloud_messages to anon, authenticated;
create policy "public chat read" on public.lizhi_cloud_messages for select to anon, authenticated using (true);

create function public.lizhi_send_message(p_id uuid, p_device_id uuid, p_device_name text, p_content text)
returns public.lizhi_cloud_messages language plpgsql security definer set search_path = '' as $$
declare saved public.lizhi_cloud_messages;
begin
  if p_id is null or p_device_id is null or p_content is null or char_length(btrim(p_content)) not between 1 and 10000
    or p_device_name is null or char_length(btrim(p_device_name)) not between 1 and 40 then
    raise exception 'invalid_message' using errcode = '22023';
  end if;
  -- Serialize bounded writes, including retries and rate checks.
  perform pg_advisory_xact_lock(418018);
  select * into saved from public.lizhi_cloud_messages where id = p_id;
  if found then
    if saved.device_id <> p_device_id or saved.content <> btrim(p_content) then
      raise exception 'message_id_conflict' using errcode = '22023';
    end if;
    return saved;
  end if;
  if (select count(*) from public.lizhi_cloud_messages where created_at > clock_timestamp() - interval '1 minute') >= 300
     or (select count(*) from public.lizhi_cloud_messages where device_id = p_device_id and created_at > clock_timestamp() - interval '1 minute') >= 30 then
    raise exception 'rate_limit' using errcode = 'P0001';
  end if;
  if (select count(*) from public.lizhi_cloud_messages) >= 10000 then
    raise exception 'storage_limit' using errcode = 'P0001';
  end if;
  insert into public.lizhi_cloud_messages(id, device_id, device_name, content)
    values (p_id, p_device_id, btrim(p_device_name), btrim(p_content)) returning * into saved;
  return saved;
end;
$$;
revoke all on function public.lizhi_send_message(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.lizhi_send_message(uuid, uuid, text, text) to anon, authenticated;
commit;
