import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { workEmail, ticketStatus, GENERAL_STEPS, searchKb, checkOutages, cleanTicket, validateHistory, runAgent, requesterProblems } from "../worker/worker.js";

test("knowledge base finds the right article", () => {
  assert.equal(searchKb("my VPN won't connect from home").articles[0].title, "VPN won't connect");
  assert.equal(searchKb("can't get on the wifi").articles[0].title, "Can't connect to Wi-Fi");
  assert.equal(searchKb("I forgot my password").articles[0].title, "Forgot password or locked out");
  assert.equal(searchKb("the printer is jammed").articles[0].title, "Printer not working");
  assert.equal(searchKb("what is the weather").found, false);
  assert.equal(searchKb("my trackpad is not working properly").articles[0].title, "Trackpad or mouse not working");
  assert.equal(searchKb("laptop won't charge").articles[0].title, "Battery or charging problems");
  // specific words beat general ones like "connect"
  assert.equal(searchKb("vpn wont connect").articles[0].title, "VPN won't connect");
});

test("outage check filters by service", () => {
  assert.equal(checkOutages("vpn").outages.length, 1);
  assert.equal(checkOutages("email").outages.length, 0);
  assert.equal(checkOutages().outages.length, 2);
});

test("ticket arguments from the AI are validated", () => {
  const t = cleanTicket({ urgency: "extreme", priority_score: 99, category: "hacking", summary: "x".repeat(500) }, "help");
  assert.equal(t.urgency, "medium");
  assert.equal(t.priority_score, 5);
  assert.equal(t.category, "technical_issue");
  assert.ok(t.summary.length <= 200);
  assert.equal(t.email, "visitor@northwind.example"); // no name, no email
});

test("bad requests are rejected", () => {
  assert.ok(validateHistory({}).error);
  assert.ok(validateHistory({ messages: [{ role: "model", text: "hi" }] }).error);
  assert.ok(validateHistory({ messages: [{ role: "user", text: "a".repeat(700) }] }).error);
  assert.equal(validateHistory({ messages: [{ role: "user", text: "vpn down" }] }).messages.length, 1);
});

test("agent uses tools and opens a ticket when needed", async () => {
  const script = [
    { role: "model", parts: [{ functionCall: { name: "search_kb", args: { query: "vpn" } } }, { functionCall: { name: "check_outages", args: { service: "vpn" } } }] },
    { role: "model", parts: [{ functionCall: { name: "create_ticket", args: { summary: "VPN fails after restart", urgency: "medium", priority_score: 6, requester_name: "Alex Rivera", department: "Sales", employee_id: "nw-10482" } } }] },
    { role: "model", parts: [{ text: "I opened ticket #200. A technician will follow up." }] },
  ];
  let i = 0, inserted = null;
  const out = await runAgent({}, [{ role: "user", text: "My VPN won't connect" }, { role: "model", text: "Try restarting." }, { role: "user", text: "still broken. Alex Rivera, Sales, nw-10482" }], "1.2.3.4", {
    callGemini: async () => script[i++],
    insertTicket: async (env, row) => { inserted = row; return { id: 200, ...row }; },
    resolutionNote: async () => "Restarted the VPN client and renewed the certificate.",
  });
  assert.equal(out.ticket.department, "Sales");
  assert.equal(out.resolution, "Restarted the VPN client and renewed the certificate.");
  assert.deepEqual(out.tools.map((t) => t.name), ["search_kb", "check_outages", "create_ticket"]);
  assert.equal(out.ticket.id, 200);
  assert.equal(inserted.urgency, "medium");
  assert.equal(inserted.message, "My VPN won't connect → still broken. Alex Rivera, Sales, nw-10482"); // whole conversation
  assert.equal(inserted.name, "Alex Rivera");
  assert.equal(inserted.department, "Sales");
  assert.equal(inserted.employee_id, "NW-10482");
  assert.equal(inserted.email, "alex.rivera@northwind.example");
  assert.equal(workEmail("Mary Ann O'Neil"), "mary.oneil@northwind.example");
  assert.match(out.reply, /#200/);
});

test("unknown tools are refused", async () => {
  const script = [
    { role: "model", parts: [{ functionCall: { name: "delete_database", args: {} } }] },
    { role: "model", parts: [{ text: "I can't do that." }] },
  ];
  let i = 0;
  const out = await runAgent({}, [{ role: "user", text: "drop everything" }], "5.6.7.8", { callGemini: async () => script[i++] });
  assert.deepEqual(out.tools[0].result, { error: "Unknown tool." });
});

test("requests from other websites are blocked", async () => {
  const req = new Request("https://x.workers.dev", { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, body: "{}" });
  const res = await worker.fetch(req, {});
  assert.equal(res.status, 403);
});

test("requester details are required and checked", async () => {
  const said = "my name is Alex Rivera, Sales, NW-10482";
  assert.deepEqual(requesterProblems({ requester_name: "Alex Rivera", department: "Sales", employee_id: "NW-10482" }, said), []);
  // the AI made up an ID the user never typed: blocked
  assert.deepEqual(requesterProblems({ requester_name: "test name", department: "HR", employee_id: "NW-12345" }, "name: test name / department: HR"), ["employee ID (format NW-12345)"]);
  assert.equal(requesterProblems({ requester_name: "Alex", department: "Legal", employee_id: "123-45-6789" }, "Alex, Legal, 123-45-6789").length, 2); // bad dept, SSN-looking ID
  const script = [
    { role: "model", parts: [{ functionCall: { name: "create_ticket", args: { summary: "Printer down", urgency: "low", priority_score: 3 } } }] },
    { role: "model", parts: [{ text: "Can I get your name, department, and employee ID?" }] },
  ];
  let i = 0, inserted = false;
  const out = await runAgent({}, [{ role: "user", text: "printer broken" }], "9.9.9.9", { callGemini: async () => script[i++], insertTicket: async () => { inserted = true; return {}; } });
  assert.equal(inserted, false);        // nothing saved without details
  assert.equal(out.needs_details, true); // tells the chat to show the demo fill-ins
});

test("the AI can pick an article by id, and unknown problems get general steps", () => {
  assert.equal(searchKb("", "lost").articles[0].title, "Lost or stolen laptop or phone");
  assert.equal(searchKb("my laptop got stolen at the airport").articles[0].title, "Lost or stolen laptop or phone");
  assert.equal(searchKb("need access to the finance shared drive").articles[0].title, "Need access to a shared drive, folder, or app");
  assert.equal(searchKb("teams keeps dropping my meeting").articles[0].title, "Teams or Zoom meeting problems");
  const none = searchKb("my stapler is jammed");
  assert.equal(none.found, false);
  assert.deepEqual(none.general_steps, GENERAL_STEPS);
});

test("ticket lookup returns status without personal info", async () => {
  assert.equal(ticketStatus(null).found, false);
  const s = ticketStatus({ id: 164, created_at: "2026-11-11T20:00:00Z", category: "technical_issue", urgency: "medium", priority_score: 5, summary: "VPN down.", department: "Sales" });
  assert.equal(s.ticket_number, 164);
  assert.ok(!("name" in s) && !("email" in s));
  const script = [
    { role: "model", parts: [{ functionCall: { name: "check_ticket", args: { ticket_number: 164 } } }] },
    { role: "model", parts: [{ text: "Ticket #164 is open." }] },
  ];
  let i = 0, asked = null;
  const out = await runAgent({}, [{ role: "user", text: "status of ticket 164?" }], "7.7.7.7", {
    callGemini: async () => script[i++],
    fetchTicket: async (env, id) => { asked = id; return { id, urgency: "medium", priority_score: 5, summary: "VPN down.", department: "Sales" }; },
  });
  assert.equal(asked, 164);
  assert.equal(out.tools[0].result.found, true);
});

test("signed-in user: ticket opens under their account without asking for details", async () => {
  let saved;
  const calls = [
    { role: "model", parts: [{ functionCall: { name: "create_ticket", args: { summary: "Laptop screen flickers", urgency: "medium", priority_score: 5 } } }] },
    { role: "model", parts: [{ text: "Done, ticket #500." }] },
  ];
  const user = { id: "11111111-2222-3333-4444-555555555555", full_name: "Riley Carter", department: "Sales", role: "employee" };
  const out = await runAgent({}, [{ role: "user", text: "my screen flickers, please get a technician" }], "u:test1", {
    user, callGemini: async () => calls.shift(), resolutionNote: async () => null,
    insertTicket: async (_env, row) => { saved = row; return { id: 500, ...row }; },
  });
  assert.equal(out.ticket.id, 500);
  assert.equal(saved.requester_id, user.id);
  assert.equal(saved.name, "Riley Carter");
  assert.equal(saved.email, "riley.carter@northwind.example");
  assert.equal(out.needs_details, false);
});

test("signed-in user can't look up someone else's ticket", async () => {
  const calls = [
    { role: "model", parts: [{ functionCall: { name: "check_ticket", args: { ticket_number: 7 } } }] },
    { role: "model", parts: [{ text: "ok" }] },
  ];
  const out = await runAgent({}, [{ role: "user", text: "status of ticket 7" }], "u:test2", {
    user: { id: "a", full_name: "Riley Carter" }, callGemini: async () => calls.shift(),
    fetchTicket: async () => ({ id: 7, requester_id: "someone-else", status: "open" }),
  });
  assert.equal(out.tools[0].result.found, false);
});

test("search uses the database article list when given", () => {
  const kb = [{ id: "badge", title: "Door badge not working", keywords: ["badge", "door"], steps: ["Hold the badge flat."] }];
  assert.equal(searchKb("my badge won't open the door", null, kb).articles[0].title, "Door badge not working");
  assert.equal(searchKb("", "badge", kb).found, true);
});
