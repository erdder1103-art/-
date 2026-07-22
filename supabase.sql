-- 在 Supabase SQL Editor 執行一次
create table if not exists public.trip_wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  expenses jsonb not null default '[]'::jsonb,
  rate numeric not null default 43,
  updated_at timestamptz not null default now()
);

alter table public.trip_wallets enable row level security;

drop policy if exists "Users can read own wallet" on public.trip_wallets;
create policy "Users can read own wallet"
on public.trip_wallets for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own wallet" on public.trip_wallets;
create policy "Users can insert own wallet"
on public.trip_wallets for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own wallet" on public.trip_wallets;
create policy "Users can update own wallet"
on public.trip_wallets for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
