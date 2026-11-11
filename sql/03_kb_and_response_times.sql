-- Northwind Service Desk, part 2: editable knowledge base and response-time tracking.
-- Run once in the Supabase SQL Editor, after 01 and 02.

-- 1. Knowledge base articles (the helpdesk agent reads these; admins edit them)
create table public.kb_articles (
  id         text primary key check (id ~ '^[a-z0-9-]{2,40}$'),
  title      text not null check (length(title) between 3 and 120),
  keywords   text[] not null default '{}',
  steps      text[] not null check (cardinality(steps) between 1 and 10),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) default auth.uid()
);
alter table public.kb_articles enable row level security;

create policy "signed-in users read articles" on public.kb_articles for select to authenticated using (true);
create policy "admins add articles"    on public.kb_articles for insert to authenticated with check (public.my_role() = 'admin');
create policy "admins edit articles"   on public.kb_articles for update to authenticated using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
create policy "admins delete articles" on public.kb_articles for delete to authenticated using (public.my_role() = 'admin');
grant select, insert, update, delete on public.kb_articles to authenticated;
grant select on public.kb_articles to service_role;

create or replace function public.touch_article() returns trigger
language plpgsql set search_path = public as $$
begin new.updated_at := now(); new.updated_by := auth.uid(); return new; end $$;
create trigger kb_touch before update on public.kb_articles for each row execute function public.touch_article();

-- Starting articles (same as the agent's built-in list)
insert into public.kb_articles (id, title, keywords, steps) values
  ('wifi', 'Can''t connect to Wi-Fi', array['wifi','wi-fi','wireless','internet','network','connect','connection','offline']::text[], array['If you''re reporting this from your phone or another device, that''s fine. Do these steps on the laptop.','Turn Wi-Fi off and back on, then pick the network "Northwind-Staff" (not "Northwind-Guest").','Forget the network and reconnect, signing in with your Northwind username and password.','Restart the laptop.','Check whether other devices nearby can connect. If none can, it may be an outage.']::text[]),
  ('vpn', 'VPN won''t connect', array['vpn','remote','home','globalprotect','tunnel','work from home']::text[], array['Make sure your home internet works first (open any website).','Quit the VPN app completely and open it again.','Sign in again; an expired password is the most common cause.','If you get a certificate error, restart the laptop so updates can finish.']::text[]),
  ('password', 'Forgot password or locked out', array['password','locked','lockout','reset','forgot','login','log in','sign in','mfa','2fa','authenticator']::text[], array['Use the self-service reset at the sign-in page ("Forgot password").','After 5 wrong attempts, accounts lock for 15 minutes, then unlock on their own.','If you lost your phone for MFA, IT has to verify your identity, so a ticket is needed.']::text[]),
  ('printer', 'Printer not working', array['printer','print','printing','scan','scanner','paper','toner']::text[], array['Check the printer screen for paper jams or low toner.','Make sure you picked the right printer (they''re named by floor, like "FL2-Main").','Remove the printer from your computer and add it again.','Restart the printer by holding the power button for 5 seconds.']::text[]),
  ('email', 'Outlook or email problems', array['outlook','email','e-mail','mail','inbox','calendar','teams']::text[], array['Check https://status.northwind.example for an email outage.','Close Outlook fully and reopen it.','If emails are stuck in the Outbox, check for a large attachment (over 25 MB).','Try Outlook on the web. If it works there, the desktop app needs repair.']::text[]),
  ('slow', 'Computer is slow', array['slow','freeze','freezing','lag','crash','frozen','hang','performance']::text[], array['Restart the computer (many problems clear up after a restart, especially if it has been on for days).','Close browser tabs and apps you aren''t using.','Install pending updates, then restart.','If it is still slow, it may need a hardware check.']::text[]),
  ('trackpad', 'Trackpad or mouse not working', array['trackpad','touchpad','mouse','cursor','pointer','click','clicking','scroll','scrolling']::text[], array['Check the trackpad isn''t turned off: press the trackpad key (often F6, F7, or Fn + a touchpad icon).','Clean the trackpad and make sure your hands are dry.','For a wireless mouse: replace the battery or recharge it, and re-plug the USB receiver.','Restart the laptop. If it still doesn''t work, it''s likely a hardware problem and needs a technician.']::text[]),
  ('keyboard', 'Keyboard problems', array['keyboard','keys','key','typing','type','sticky','stuck']::text[], array['Restart the laptop.','Check that Num Lock or Caps Lock isn''t causing the issue.','For an external keyboard, unplug it and plug it into a different USB port.','If keys are physically stuck or broken, it needs a hardware repair.']::text[]),
  ('display', 'Screen or monitor problems', array['screen','monitor','display','black','flicker','flickering','dock','docking','resolution','projector','hdmi']::text[], array['Check the monitor''s power and that the cable is firmly plugged in at both ends.','Press Windows + P and pick "Extend" or "Duplicate".','If you use a dock, unplug it for 10 seconds and plug it back in.','If the laptop screen is cracked, black, or lined, it needs a hardware repair.']::text[]),
  ('battery', 'Battery or charging problems', array['battery','charge','charging','charger','power','dead','turn on','won''t turn on','plugged']::text[], array['Try a different outlet and check that the charger light is on.','Plug the charger directly into the laptop, not through a dock.','Hold the power button for 15 seconds, then try turning it on again.','If it still won''t charge or turn on, the battery or charger likely needs replacing.']::text[]),
  ('audio', 'Sound, microphone, or headset problems', array['sound','audio','speaker','speakers','headset','headphones','microphone','mic','volume','hear']::text[], array['Check the volume and that the right output or input device is selected (click the speaker icon).','Unplug the headset and plug it back in, or re-pair it over Bluetooth.','In Teams, check Settings, then Devices, to pick the right microphone and speaker.','If no device works, it may be a hardware problem.']::text[]),
  ('webcam', 'Webcam not working', array['webcam','camera','video','cam']::text[], array['Check for a privacy shutter or a camera key that turns the webcam off.','Close other apps that might be using the camera.','In Teams, check Settings, then Devices, and pick the right camera.','Restart the laptop. If it''s still not detected, it needs a technician.']::text[]),
  ('phishing', 'Suspicious email or link', array['phishing','suspicious','scam','clicked','link','virus','hacked','malware']::text[], array['Don''t click links or open attachments in the email.','Use the "Report phishing" button in Outlook.','If you already clicked a link or entered your password, this is urgent: IT needs to reset your password right away.']::text[]),
  ('access', 'Need access to a shared drive, folder, or app', array['access','permission','permissions','shared','drive','folder','denied','request','sharepoint']::text[], array['Access has to be approved by your manager or the owner of the folder or app, so IT can''t add it on the spot.','Tell me the exact name of the folder, drive, or app, and I''ll open a request ticket.','If you used to have access and it stopped, sign out and back in first, since a password change can cause this.']::text[]),
  ('software', 'Install or update software', array['install','installing','software','program','app','application','download','license','admin']::text[], array['Check the Company Portal app on your laptop. Approved software can be installed from there without IT.','If it''s not in the Company Portal, it needs approval, and I can open a request ticket.','Don''t download installers from websites. Unapproved software can be a security risk.']::text[]),
  ('meetings', 'Teams or Zoom meeting problems', array['teams','zoom','meeting','call','share','screen share','join','webex']::text[], array['Quit Teams or Zoom completely (also from the system tray) and reopen it.','Check that the right microphone, speaker, and camera are selected in the app''s settings.','Try joining from the web version or your phone to see if the problem is the app.','If screen sharing fails, check the app has screen recording permission and restart.']::text[]),
  ('onedrive', 'OneDrive or file sync problems', array['onedrive','sync','syncing','file','files','cloud','saved','missing','deleted','recover']::text[], array['Click the OneDrive cloud icon near the clock to see if it''s paused or showing an error.','Sign out of OneDrive and sign back in.','Deleted files can usually be restored from the OneDrive recycle bin for 30 days.','If a file is still missing, a technician can help restore it.']::text[]),
  ('lost', 'Lost or stolen laptop or phone', array['lost','stolen','missing laptop','left','theft','stole','misplaced']::text[], array['This is urgent. IT needs to lock the device and protect company data right away.','Change your Northwind password from another device.','I''ll open a high-priority ticket so a technician can remotely lock and wipe the device.']::text[]),
  ('updates', 'Windows update stuck or blue screen', array['update','updates','updating','stuck','blue screen','bsod','restart loop','crash','error']::text[], array['If an update is stuck, leave the laptop plugged in for 30 minutes; big updates can be slow.','If it''s frozen for over an hour, hold the power button for 10 seconds and turn it back on.','For a blue screen, write down the stop code shown on the screen, then restart.','If the blue screen happens again, it needs a technician.']::text[]),
  ('storage', 'Disk full or out of storage', array['storage','disk','space','full','drive full','low space','memory']::text[], array['Empty the Recycle Bin and clear your Downloads folder.','Open Settings, then System, then Storage, and run Cleanup recommendations.','Move large files to OneDrive so they don''t take up space on the laptop.']::text[]),
  ('browser', 'Website not loading or browser problems', array['website','browser','chrome','edge','page','site','loading','load','cookies','cache']::text[], array['Try the site in a private or incognito window.','Clear the browser''s cache and cookies, then restart the browser.','Try a different browser (Edge or Chrome).','If one company site is down for everyone, it may be an outage.']::text[]),
  ('mobile', 'Set up work email on a phone', array['phone','mobile','iphone','android','cell','outlook app','setup','set up']::text[], array['Install the Outlook app from the App Store or Google Play.','Sign in with your Northwind email and password.','Approve the sign-in in your authenticator app, and allow the app''s security settings if asked.']::text[])
on conflict (id) do nothing;

-- 2. Response-time tracking: first staff reply, and a target by urgency
alter table public.tickets add column first_response_at timestamptz;

create or replace function public.mark_first_response() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not new.internal and exists (select 1 from profiles where id = new.author_id and role in ('technician','admin')) then
    update tickets set first_response_at = now() where id = new.ticket_id and first_response_at is null;
  end if;
  return new;
end $$;
create trigger notes_first_response after insert on public.ticket_notes for each row execute function public.mark_first_response();

-- Target hours: high 4, medium 24, low 72
create or replace function public.response_target_hours(urgency text) returns int
language sql immutable as $$ select case urgency when 'high' then 4 when 'low' then 72 else 24 end $$;

drop view if exists public.desk_stats;
create view public.desk_stats with (security_invoker = true) as
select
  count(*) filter (where status = 'open')        as open_tickets,
  count(*) filter (where status = 'in_progress') as in_progress,
  count(*) filter (where status = 'resolved')    as resolved,
  count(*) filter (where status <> 'resolved' and first_response_at is null
                   and created_at < now() - make_interval(hours => public.response_target_hours(urgency))) as overdue,
  round(avg(extract(epoch from (first_response_at - created_at)) / 3600)::numeric, 1) as avg_hours_to_first_reply,
  round(avg(extract(epoch from (resolved_at - created_at)) / 3600)::numeric, 1)        as avg_hours_to_resolve
from public.tickets;
grant select on public.desk_stats to authenticated;

-- 3. The agent (service_role) reads profiles to know who is signed in, and tickets with status
grant select on public.profiles to service_role;
grant select on public.tickets to service_role;
