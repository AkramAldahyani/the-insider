/**
 * Generates scenarios/nexora-large.json (Phase 6, part I): the company of the
 * small office with 30 people instead of 11, for maps/office-large.json.
 *
 *   pnpm scenario
 *
 * Everything of the small office stays exactly as it is (the same people,
 * machines, files, weaknesses and the flag); this script adds nineteen
 * colleagues, their PCs, a little of their work and history, and tasks for the
 * two new departments. Run `pnpm map` too if the desks change.
 *
 * Like build-office.ts this is a build tool: the game never runs it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
type Json = Record<string, unknown>;
const small = JSON.parse(readFileSync(join(HERE, 'nexora-small.json'), 'utf8')) as Json & {
  accounts: Json[]; players: Json[]; hosts: Json[]; history: Json[]; tasks: Json[]; mail: { history: { to: string[] }[] };
};

interface Colleague {
  name: string;
  user: string;
  title: string;
  department: string;
  desk: string;
  password: string;
  strength: number;
  badge: string;
  /** Lines of their to-do list, and one file of their work: [path under home, lines]. */
  todo: string[];
  work: [string, string[]];
  /** What they typed before (their .bash_history). */
  typed: string[];
  /** Their PC when the match begins. */
  console: 'locked' | 'login' | 'unlocked';
}

const PEOPLE: Colleague[] = [
  { name: 'Fatima Al-Qahtani', user: 'f.alqahtani', title: 'Senior Accountant', department: 'Finance', desk: 'FIN-LT-01', password: 'Qahtani#Ledger9', strength: 60, badge: '0420', console: 'locked',
    todo: ['[ ] close the February ledger', '[ ] check the VAT report with Sara', '[x] bank reconciliation'], work: ['Documents/ledger_notes.txt', ['February ledger: 3 entries still open', 'Ask Rami about the vendor review before Thursday']], typed: ['ls Documents', 'cat todo.txt'] },
  { name: 'Ahmed Zaki', user: 'a.zaki', title: 'Payroll Officer', department: 'Finance', desk: 'FIN-LT-02', password: 'payroll2026', strength: 20, badge: '0431', console: 'login',
    todo: ['[ ] payroll run on the 25th', '[ ] new hires from HR (ask Jana)'], work: ['payroll/checklist.txt', ['1. collect hours', '2. check new hires', '3. send to the bank']], typed: ['ls payroll', 'cat payroll/checklist.txt'] },
  { name: 'Reem Saeed', user: 'r.saeed', title: 'Finance Assistant', department: 'Finance', desk: 'FIN-LT-03', password: 'Reem2003', strength: 22, badge: '0436', console: 'locked',
    todo: ['[ ] scan the receipts', '[ ] order printer paper'], work: ['Documents/receipts_march.txt', ['taxi 45.00', 'courier 120.00', 'coffee beans 88.50']], typed: ['ls', 'cat todo.txt'] },
  { name: 'Jana Khoury', user: 'j.khoury', title: 'Recruiter', department: 'HR', desk: 'HR-LT-01', password: 'Jana!Hires22', strength: 50, badge: '0296', console: 'locked',
    todo: ['[ ] interviews on Wednesday', '[ ] send the offer letter for the Sales job'], work: ['Documents/candidates.txt', ['Sales: 4 candidates, 2 interviews', 'Legal: paralegal post filled (Sami)']], typed: ['cat Documents/candidates.txt'] },
  { name: 'Bilal Ahmed', user: 'b.ahmed', title: 'HR Assistant', department: 'HR', desk: 'HR-LT-02', password: 'bilal123', strength: 10, badge: '0298', console: 'unlocked',
    todo: ['[ ] update the phone list', '[ ] book the training room'], work: ['Documents/phone_list.txt', ['Reception  100', 'IT         200', 'Security   300', 'Sales      400', 'Legal      500']], typed: ['ls Documents', 'cat Documents/phone_list.txt'] },
  { name: 'Layla Nasr', user: 'l.nasr', title: 'Content Writer', department: 'Marketing', desk: 'MKT-LT-01', password: 'Words&Coffee5', strength: 55, badge: '0461', console: 'locked',
    todo: ['[ ] blog post for the spring launch', '[ ] newsletter draft'], work: ['drafts/newsletter.txt', ['Spring is here at Nexora!', '(ask Omar for the dates)']], typed: ['ls drafts', 'cat todo.txt'] },
  { name: 'Hassan Ali', user: 'h.ali', title: 'Social Media Manager', department: 'Marketing', desk: 'MKT-LT-02', password: 'hassan2025', strength: 18, badge: '0467', console: 'login',
    todo: ['[ ] schedule posts for March', '[ ] reply to comments'], work: ['social/schedule.txt', ['Mon: teaser', 'Wed: team photo', 'Fri: launch']], typed: ['cat social/schedule.txt'] },
  { name: 'Mona Fares', user: 'm.fares', title: 'Marketing Analyst', department: 'Marketing', desk: 'MKT-LT-03', password: 'Fares!Stats7', strength: 52, badge: '0472', console: 'locked',
    todo: ['[ ] campaign numbers for February', '[ ] dashboard for Faisal (Sales)'], work: ['reports/feb_campaign.csv', ['channel,clicks,leads', 'mail,1204,31', 'social,3311,18', 'web,980,22']], typed: ['ls reports', 'cat reports/feb_campaign.csv'] },
  { name: 'Faisal Otaibi', user: 'f.otaibi', title: 'Sales Manager', department: 'Sales', desk: 'SAL-LT-01', password: 'Otaibi@Sales!24', strength: 68, badge: '0501', console: 'locked',
    todo: ['[ ] quarterly targets', '[ ] meet Najd Catering about the renewal'], work: ['sales/pipeline.csv', ['client,stage,value_sar', 'Najd Catering,renewal,48000', 'Red Sea Logistics,proposal,120000', 'Gulf Office Supplies,won,22000']], typed: ['cat sales/pipeline.csv', 'mail'] },
  { name: 'Nadia Karim', user: 'n.karim', title: 'Account Executive', department: 'Sales', desk: 'SAL-LT-02', password: 'nadia2024', strength: 16, badge: '0508', console: 'unlocked',
    todo: ['[ ] call Red Sea Logistics', '[ ] send the price list'], work: ['sales/calls.txt', ['Red Sea Logistics: call back Tuesday', 'Desert Cloud Hosting: not interested']], typed: ['cat sales/calls.txt'] },
  { name: 'Ziad Hamdan', user: 'z.hamdan', title: 'Account Executive', department: 'Sales', desk: 'SAL-LT-03', password: 'Hamdan-Deals-3', strength: 48, badge: '0511', console: 'locked',
    todo: ['[ ] two demos this week', '[ ] update the CRM'], work: ['sales/demos.txt', ['Tue 10:00 Falcon Security Systems', 'Thu 14:00 Najd Catering']], typed: ['cat sales/demos.txt'] },
  { name: 'Salma Idris', user: 's.idris', title: 'Sales Assistant', department: 'Sales', desk: 'SAL-LT-04', password: 'salma1', strength: 8, badge: '0515', console: 'login',
    todo: ['[ ] print the contracts for Faisal', '[ ] book the meeting room'], work: ['sales/contracts_to_print.txt', ['Najd Catering renewal (2 copies)', 'Gulf Office Supplies (1 copy)']], typed: ['ls sales'] },
  { name: 'Kareem Nabil', user: 'k.nabil', title: 'Account Executive', department: 'Sales', desk: 'SAL-LT-05', password: 'Kareem#Nabil90', strength: 58, badge: '0519', console: 'locked',
    todo: ['[ ] visit the new client in the north', '[ ] expense claim for the trip'], work: ['sales/trip.txt', ['Hotel: 2 nights', 'Car: company car (ask Maha for the keys)']], typed: ['cat sales/trip.txt'] },
  { name: 'Hind Mahmoud', user: 'h.mahmoud', title: 'Sales Analyst', department: 'Sales', desk: 'SAL-LT-06', password: 'Hind!Numbers4', strength: 54, badge: '0523', console: 'locked',
    todo: ['[ ] forecast for Q2', '[ ] compare with Marketing leads (Mona)'], work: ['sales/forecast_q2.txt', ['Q2 forecast: +8% if Red Sea Logistics signs', 'otherwise +2%']], typed: ['cat sales/forecast_q2.txt'] },
  { name: 'Rana Shami', user: 'r.shami', title: 'Legal Counsel', department: 'Legal', desk: 'LEG-LT-01', password: 'Shami$Counsel77', strength: 72, badge: '0601', console: 'locked',
    todo: ['[ ] review the Najd Catering renewal', '[ ] privacy policy update'], work: ['contracts/najd_catering_renewal.txt', ['Renewal for 12 months, 48,000 SAR', 'Clause 7 (termination) needs a change']], typed: ['ls contracts', 'cat contracts/najd_catering_renewal.txt'] },
  { name: 'Adel Mustafa', user: 'a.mustafa', title: 'Contracts Manager', department: 'Legal', desk: 'LEG-LT-02', password: 'contracts2026', strength: 20, badge: '0605', console: 'login',
    todo: ['[ ] sign-off list for Faisal', '[ ] archive the 2025 contracts'], work: ['contracts/to_sign.txt', ['Gulf Office Supplies - ready', 'Red Sea Logistics - waiting for the price']], typed: ['cat contracts/to_sign.txt'] },
  { name: 'Sami Yasin', user: 's.yasin', title: 'Paralegal', department: 'Legal', desk: 'LEG-LT-03', password: 'sami2026', strength: 14, badge: '0609', console: 'unlocked',
    todo: ['[ ] first week: read the handbook', '[ ] ask IT for a second screen'], work: ['handbook_notes.txt', ['Contracts go to the archive room after signing', 'Lock the screen! (Noor said so twice)']], typed: ['cat handbook_notes.txt'] },
  { name: 'Majed Saleem', user: 'm.saleem', title: 'Software Developer', department: 'IT', desk: 'IT-WS-03', password: 'Majed-Dev-Build-8', strength: 66, badge: '0221', console: 'locked',
    todo: ['[ ] fix the intranet login page', '[ ] code review for Dana'], work: ['code/intranet/TODO.md', ['- login page: show the error message', '- news page: sort by date']], typed: ['ls code/intranet', 'cat code/intranet/TODO.md', 'ping -c 1 intranet.nexora.local'] },
  { name: 'Aisha Bakr', user: 'a.bakr', title: 'Office Assistant', department: 'Reception', desk: 'REC-PC-02', password: 'aisha2025', strength: 15, badge: '0238', console: 'login',
    todo: ['[ ] order water for the cafeteria', '[ ] post for Legal'], work: ['orders.txt', ['water: 20 bottles', 'coffee: 4 kg', 'paper: 10 boxes']], typed: ['cat orders.txt'] },
];

/** Where a department's PCs are, as written in their "location". */
const PLACE: Record<string, string> = { Finance: 'Finance', HR: 'HR', Marketing: 'Marketing', Sales: 'Sales', Legal: 'Legal', IT: 'IT department', Reception: 'Reception' };
const MAC: Record<string, string> = { Finance: 'f1', HR: 'b2', Marketing: 'c3', Sales: '5a', Legal: '1e', IT: '17', Reception: 'd4' };
const hex = (n: number) => n.toString(16).padStart(2, '0');

const accounts = [...small.accounts];
const players = [...small.players];
const hosts = [...small.hosts];
const history = [...small.history];
PEOPLE.forEach((p, i) => {
  const number = Number(/\d+$/.exec(p.desk)![0]);
  accounts.push({ username: p.user, fullName: p.name, title: p.title, department: p.department, password: p.password, strength: p.strength, badge: { id: p.badge } });
  players.push({ id: `p${12 + i}`, name: p.name, account: p.user, desk: p.desk, role: 'employee' });
  const home = `/home/${p.user}`;
  hosts.push({
    hostname: p.desk,
    kind: 'workstation',
    department: p.department,
    location: `${PLACE[p.department]}, desk ${number}`,
    mac: `52:54:00:${MAC[p.department]}:${hex(number + 0x20)}:${hex(number + 0x20)}`,
    owner: p.user,
    users: [p.user, 'k.nasser'],
    sudoers: ['k.nasser'],
    uptimeMinutes: 3000 + i * 97,
    ...(p.console === 'login' ? {} : { console: { user: p.user, state: p.console, loginMinutesAgo: 10 + i * 3 } }),
    bashHistory: { [p.user]: p.typed },
    files: [
      { path: `${home}/todo.txt`, ageMinutes: 900 + i * 37, content: p.todo },
      { path: `${home}/${p.work[0]}`, ageMinutes: 2000 + i * 53, content: p.work[1] },
    ],
  });
  history.push({ type: 'console-session', host: p.desk, user: p.user, minutesAgo: 4240 - i * 5, durationMinutes: 420 + (i % 5) * 15 });
});

// The new departments' own tasks.
const tasks = [
  ...small.tasks,
  { id: 'pipeline', title: 'Update the sales pipeline', departments: ['Sales'], steps: [
    { text: 'Write today’s calls into a note', run: 'echo "{date}: called 3 clients" >> calls_{n}.txt', match: '^echo .*>+ *calls_\\d+\\.txt' },
    { text: 'Check the note', run: 'cat calls_{n}.txt', match: '^cat .*calls_\\d+\\.txt' },
  ] },
  { id: 'contract-review', title: 'Review a contract', departments: ['Legal'], steps: [
    { text: 'Open your contracts', run: 'ls contracts', match: '^ls .*contracts' },
    { text: 'Note what to change', run: 'echo "clause {n}: check" >> review_{n}.txt', match: '^echo .*>+ *review_\\d+\\.txt' },
  ] },
];

// Everybody gets the reminder to lock their screen.
const mail = JSON.parse(JSON.stringify(small.mail)) as { history: { subject?: string; to: string[] }[] };
const reminder = mail.history.find((m) => m.subject === 'Reminder: lock your screen');
if (reminder) reminder.to = accounts.map((a) => String(a.username)).filter((u) => u !== 'n.saleh' && u !== 'h.rahman');

const large = {
  ...small,
  id: 'nexora-large',
  name: 'Nexora Corp - Large Office',
  description: 'The same company with 30 people on one wide floor: two more departments (Sales and Legal), a lounge and an archive. The flag is /root/flag.txt on ADMIN-SRV-01.',
  accounts, players, hosts, history, tasks, mail,
};
writeFileSync(join(HERE, 'nexora-large.json'), `${JSON.stringify(large, null, 2)}\n`);
console.log(`Wrote scenarios/nexora-large.json (${players.length} people, ${hosts.length} machines)`);
