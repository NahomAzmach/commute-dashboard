create extension if not exists vector with schema extensions;
create extension if not exists pg_cron;

create table if not exists public.camera_frames (
  id bigint generated always as identity primary key,
  camera_id bigint not null,
  source text not null check (source in ('wsdot', 'seattle')),
  title text not null,
  lat double precision not null,
  lon double precision not null,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  object_key text not null unique,
  embedding_model text not null,
  embedding extensions.halfvec(768) not null,
  check (last_seen_at >= first_seen_at)
);

create index if not exists camera_frames_time_idx
  on public.camera_frames (first_seen_at desc, last_seen_at desc);
create index if not exists camera_frames_camera_time_idx
  on public.camera_frames (camera_id, first_seen_at desc);
create index if not exists camera_frames_embedding_idx
  on public.camera_frames
  using hnsw (embedding extensions.halfvec_cosine_ops);

create table if not exists public.camera_frame_signatures (
  camera_id bigint not null,
  source text not null check (source in ('wsdot', 'seattle')),
  signature text not null check (signature ~ '^[0-9a-f]{16}$'),
  frame_id bigint not null references public.camera_frames (id) on delete cascade,
  last_seen_at timestamptz not null,
  primary key (source, camera_id)
);

alter table public.camera_frames enable row level security;
alter table public.camera_frame_signatures enable row level security;
revoke all on public.camera_frames, public.camera_frame_signatures from anon, authenticated;
grant select, insert, update, delete on public.camera_frames to service_role;
grant select, insert, update, delete on public.camera_frame_signatures to service_role;
grant usage, select on sequence public.camera_frames_id_seq to service_role;

create or replace function public.search_camera_frames(
  p_query_embedding text,
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_model_id text,
  p_limit integer default 12
)
returns table (
  id bigint,
  camera_id bigint,
  source text,
  title text,
  lat double precision,
  lon double precision,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  object_key text,
  distance double precision
)
language sql
stable
security definer
set search_path = public, extensions
as $function$
  select
    frame.id,
    frame.camera_id,
    frame.source,
    frame.title,
    frame.lat,
    frame.lon,
    frame.first_seen_at,
    frame.last_seen_at,
    frame.object_key,
    (frame.embedding <=> p_query_embedding::extensions.halfvec(768))::double precision
  from public.camera_frames as frame
  where frame.embedding_model = p_model_id
    and frame.last_seen_at >= p_start_time
    and frame.first_seen_at <= p_end_time
  order by frame.embedding <=> p_query_embedding::extensions.halfvec(768)
  limit least(greatest(coalesce(p_limit, 12), 1), 12);
$function$;

drop function if exists public.search_camera_frames(text, timestamptz, timestamptz, integer);
revoke all on function public.search_camera_frames(text, timestamptz, timestamptz, text, integer)
  from public, anon, authenticated;
grant execute on function public.search_camera_frames(text, timestamptz, timestamptz, text, integer)
  to service_role;

do $retention$
declare
  existing_job integer;
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'camera-archive-retention';
  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;
  perform cron.schedule(
    'camera-archive-retention',
    '17 5 * * *',
    $sql$delete from public.camera_frames where first_seen_at < now() - interval '30 days';$sql$
  );
end;
$retention$;
