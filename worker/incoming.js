// Demo realism: a scheduled job that files a new, realistic ticket every few hours
// and resolves the oldest open ones so the queue stays around QUEUE_TARGET.
import { cleanTicket } from "./worker.js";

export const QUEUE_TARGET = 15;

export const PROBLEMS = [
  ["Outlook keeps asking for my password", "Outlook pops up a password prompt every few minutes since this morning.", "Restarted Outlook and my laptop", "medium"],
  ["Locked out of my account", "Account locked after too many sign-in attempts; can't get into email or Teams.", "", "high"],
  ["Not getting MFA codes on new phone", "Switched phones and the authenticator app no longer gives me codes.", "Reinstalled the authenticator app", "high"],
  ["Can't open the shared Finance folder", "Getting access denied on the shared Finance folder that worked last week.", "Signed out and back in", "medium"],
  ["Shared mailbox missing in Outlook", "The team shared mailbox disappeared from Outlook.", "Restarted Outlook", "low"],
  ["Teams screen share not working", "Screen share button does nothing during Teams meetings.", "Updated Teams and restarted", "medium"],
  ["Laptop battery dies after an hour", "Laptop battery drains from full to empty in about an hour.", "Lowered brightness, closed apps", "low"],
  ["Second monitor not detected", "Second monitor shows no signal when plugged into the dock.", "Unplugged and replugged the dock", "medium"],
  ["Laptop mic not picking up my voice in Teams", "Coworkers can't hear me in Teams calls on my laptop mic.", "Checked mute and Teams audio settings", "medium"],
  ["VPN connects but can't reach shared drive", "VPN says connected but the S: drive won't load from home.", "Reconnected VPN, restarted", "medium"],
  ["Wi-Fi drops in 3rd floor conference room", "Wi-Fi keeps disconnecting in the 3rd floor conference room.", "Forgot and rejoined the network", "low"],
  ["Printer shows offline", "Floor 2 printer shows offline but it's powered on.", "Turned printer off and on", "low"],
  ["Scan to email stopped working", "Scans from the copier never arrive in my inbox.", "Checked spam folder", "low"],
  ["Need Adobe Acrobat Pro installed", "Need Acrobat Pro to edit and sign PDFs for client contracts.", "", "low"],
  ["Suspicious password-expiry email", "Got an email saying my password expires today with a link; not sure if it's real.", "Did not click the link", "high"],
  ["Laptop very slow after update", "Laptop takes minutes to open apps since last night's update.", "Restarted twice", "medium"],
  ["Spilled water on work laptop", "Spilled water on my work laptop last night; it won't turn on.", "Shut it off right away and unplugged it", "high"],
  ["Laptop won't charge", "Charging light doesn't come on when plugged in.", "Tried a different outlet", "medium"],
  ["Keyboard keys not responding", "Several keys on my laptop keyboard stopped working.", "Restarted, checked Num Lock", "medium"],
  ["New hire needs account and laptop", "New team member starts Monday and needs an account and laptop set up.", "", "medium"],
];

const PEOPLE = [
  ["Meagan Moore", "Sales"], ["Meagan Moore", "Sales"], ["Meagan Moore", "Sales"],
  ["Alicia Gomez", "Finance"], ["Priya Shah", "Finance"], ["Kevin Ortiz", "IT"], ["Tom Becker", "Operations"],
  ["Marcus Lee", "Marketing"], ["Rachel Kim", "HR"], ["Dana Whitfield", "Operations"], ["Chris Nguyen", "Sales"],
  ["Laura Chen", "Operations"], ["Sam Patel", "Marketing"], ["Mike Russo", "Finance"], ["Hannah Brooks", "HR"],
  ["Kayla Bennett", "HR"], ["Tyler Brooks", "IT"], ["Lauren King", "Finance"], ["Jason Reed", "Operations"],
];

const pick = (a) => a[Math.floor(Math.random() * a.length)];

export function makeIncoming() {
  const [summary, details, tried, urgency] = pick(PROBLEMS);
  const [name, department] = pick(PEOPLE);
  const score = urgency === "high" ? 7 + Math.floor(Math.random() * 3) : urgency === "low" ? 2 + Math.floor(Math.random() * 2) : 4 + Math.floor(Math.random() * 3);
  return cleanTicket({ summary, details, steps_tried: tried, urgency, priority_score: score, requester_name: name, department,
    employee_id: "NW-" + (10000 + Math.floor(Math.random() * 90000)) }, "");
}

function headers(env) {
  const key = String(env.SUPABASE_SERVICE_KEY || "").trim();
  return { "Content-Type": "application/json", apikey: key, ...(key.startsWith("sb_") ? {} : { Authorization: `Bearer ${key}` }) };
}

export async function runIncoming(env) {
  const base = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const h = headers(env);
  const row = makeIncoming();
  const p = await fetch(`${base}/rest/v1/profiles?full_name=ilike.${encodeURIComponent(row.name)}&role=eq.employee&select=id&limit=1`, { headers: h });
  const hit = p.ok ? (await p.json())[0] : null;
  if (hit) row.requester_id = hit.id;
  await fetch(`${base}/rest/v1/tickets`, { method: "POST", headers: h, body: JSON.stringify(row) });
  // keep the queue a readable size: resolve the oldest open tickets past the target
  const q = await fetch(`${base}/rest/v1/tickets?status=neq.resolved&order=created_at.asc&select=id`, { headers: h });
  const open = q.ok ? await q.json() : [];
  const extra = open.slice(0, Math.max(0, open.length - QUEUE_TARGET)).map((t) => t.id);
  if (extra.length) await fetch(`${base}/rest/v1/tickets?id=in.(${extra.join(",")})`, { method: "PATCH", headers: h, body: JSON.stringify({ status: "resolved" }) });
}
