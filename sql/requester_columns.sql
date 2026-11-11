-- Who opened the ticket (made-up details in the public demo)
alter table public.tickets
  add column department  text check (department in ('Sales','Finance','Marketing','Operations','HR','IT')),
  add column employee_id text check (employee_id ~ '^NW-[0-9]{5}$');

-- Let the agent's server key add and read tickets (nothing else)
grant select, insert on public.tickets to service_role;
