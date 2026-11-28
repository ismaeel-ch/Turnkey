import type { Dict, SavedBuild } from '@/shared/types/workspace';

/* ===== Turnkey · the list of saved builds =====
   What the welcome screen, Home and the sentence matcher need to know about each saved build: its name, icon and
   sentence. The recordings themselves (builds.ts, quests.ts, samples.ts, about 50 KB compressed) load once the first
   screen has painted, together with the SQLite engine, so every screen that replays one waits for both. */
export type SavedCard = Pick<
  SavedBuild,
  'id' | 'title' | 'icon' | 'accent' | 'sentence' | 'blurb' | 'keys' | 'quest' | 'agents' | 'sampleNote' | 'slip'
>;

export const TEMPLATES = ['clinic', 'helpdesk', 'leave', 'biddesk'];
// Two more business apps for Home; onboarding offers only the first four, so a first-time visitor picks from a short list.
export const MORE_TEMPLATES = ['grants', 'purchasing', 'expenses'];
// Four apps that work numbers out and enforce rules (complex.ts).
export const COMPLEX_TEMPLATES = ['orders', 'vet', 'projects', 'dispatch'];
// What a software house runs on itself, first on Home: three new apps (software.ts) and four from the lists above.
export const SOFTWARE_NEW = ['sprints', 'billing', 'onboarding'];
export const SOFTWARE_TEMPLATES = ['sprints', 'billing', 'onboarding', 'projects', 'biddesk', 'helpdesk', 'leave'];
// The first-run picker ("Pick a first app"): software house apps first, the clinic last because the guided story uses it.
export const FIRST_PICKS = ['sprints', 'billing', 'onboarding', 'biddesk', 'helpdesk', 'clinic'];
export const QUESTS = ['factcheck', 'priorart', 'debate'];

export const CARDS: Dict<SavedCard> = {
  clinic: {
    id: 'clinic',
    title: 'Clinic appointments',
    icon: 'stethoscope',
    accent: 'teal',
    sentence:
      'A clinic front desk books patient appointments, doctors work from their own schedule and write visit notes, and the manager tracks no-shows.',
    blurb: 'Front desk, doctors and a manager. Visits move from booked to done.',
    keys: ['clinic', 'doctor', 'patient', 'appointment', 'hospital', 'medical', 'dentist', 'visit'],
  },
  helpdesk: {
    id: 'helpdesk',
    title: 'IT helpdesk tickets',
    icon: 'headset',
    accent: 'purple',
    sentence:
      'An IT helpdesk where employees raise tickets, support agents work a queue by priority, and the team lead watches what is due.',
    blurb: 'Employees, agents and a team lead. Tickets move from new to closed.',
    keys: ['helpdesk', 'ticket', 'support', 'it ', 'issue', 'incident', 'service desk'],
  },
  leave: {
    id: 'leave',
    title: 'Leave requests',
    icon: 'beach',
    accent: 'forest',
    sentence: 'Employees request leave, managers approve or reject it, and HR keeps balances and the team calendar.',
    blurb: 'Employees, a manager and HR. Requests move from pending to approved.',
    keys: ['leave', 'vacation', 'time off', 'holiday', 'absence', 'hr ', 'pto'],
  },
  biddesk: {
    id: 'biddesk',
    title: 'Sales bidding desk',
    icon: 'briefcase',
    accent: 'forest',
    agents: ['Qualifier', 'Pricing', 'Red team'],
    sentence:
      'A sales team bids on tenders: bid managers prepare each bid with a price, three agents score the tender, price it and challenge it, the sales director approves it before it goes out, and everyone sees what was won or lost.',
    blurb: 'Tenders, scores, price options and a go or no-go. A director approves every bid.',
    keys: ['bid', 'bidding', 'tender', 'rfp', 'proposal', 'quotation', 'quote', 'procurement', 'sales'],
    slip: 'This saved build keeps one slip on purpose, so the repair loop has something to do in Demo: the Rules builder let bid managers delete tenders, which the brief forbids.',
  },
  factcheck: {
    id: 'factcheck',
    quest: 1,
    title: 'Fact-check desk',
    icon: 'shield',
    accent: 'navy',
    agents: ['Extractor', 'Researchers', 'Verifier'],
    sampleNote: 'Evidence in the saved runs is sample data',
    sentence:
      'Editors paste a piece of text. Agents split it into claims, look for evidence and give each claim a verdict, and a senior editor signs off before it is published.',
    blurb: 'An Extractor, Researchers and a Verifier check each text, claim by claim.',
    keys: ['fact', 'claim', 'verify', 'verdict', 'misinformation', 'evidence', 'newsroom'],
  },
  priorart: {
    id: 'priorart',
    quest: 2,
    title: 'Prior-art scout',
    icon: 'lightbulb',
    accent: 'royalBlue',
    agents: ['Search', 'Analyst', 'Critic'],
    sampleNote: 'Prior work is illustrative, not real citations',
    sentence:
      'Inventors describe an idea. Agents search patents and papers for similar work, compare it with the idea and challenge the result, and an IP reviewer decides whether to pursue it.',
    blurb: 'Search, Analyst and Critic agents weigh an idea against earlier work.',
    keys: ['prior art', 'patent', 'invention', 'novelty', 'inventor', 'idea'],
  },
  debate: {
    id: 'debate',
    quest: 3,
    title: 'Debate partner',
    icon: 'scales',
    accent: 'grape',
    agents: ['For', 'Against', 'Moderator'],
    sentence:
      'A team raises a motion before a decision. One agent argues for it, one argues against it, anyone can jump in, and a moderator records what is agreed and what is still open.',
    blurb: 'For, Against and a Moderator argue a motion, and you can jump in.',
    keys: ['debate', 'argue', 'motion', 'devil', 'skeptic', 'second opinion', 'decision'],
  },
  grants: {
    id: 'grants',
    title: 'Grant review desk',
    icon: 'heart',
    accent: 'magenta',
    agents: ['Assessor', 'Budget reviewer', 'Due diligence'],
    sentence:
      'A community foundation reviews grant applications: programme officers record each one, three agents score it, size the award and check it, the board chair approves every grant, and trustees can read everything.',
    blurb: 'Applications, scores, award options and checks. The board chair approves every grant.',
    keys: ['grant', 'grants', 'foundation', 'charity', 'funding', 'donor', 'nonprofit', 'non-profit', 'award', 'applicant'],
  },
  purchasing: {
    id: 'purchasing',
    title: 'Purchase requests',
    icon: 'cart',
    accent: 'marigold',
    sentence:
      'Staff raise purchase requests, their budget holder approves or rejects each one, the buyer orders from an approved supplier, and the person who asked confirms delivery.',
    blurb: 'Staff, a budget holder and a buyer. Nothing is ordered without approval.',
    keys: ['purchase', 'purchasing', 'buy', 'buyer', 'order', 'supplier', 'vendor', 'requisition'],
  },
  expenses: {
    id: 'expenses',
    title: 'Expense manager',
    icon: 'receipt',
    accent: 'seafoam',
    sentence: 'I want to build an expense management app.',
    blurb: 'Asks who it is for first: just you, or a company where managers approve and Finance pays.',
    keys: ['expense', 'spend', 'reimburse', 'receipt'],
  },
  orders: {
    id: 'orders',
    title: 'Order desk with budgets',
    icon: 'cart',
    accent: 'marigold',
    sentence:
      'Staff raise purchase orders made of lines with a quantity and a unit price. The app totals each order and checks it against the department budget. Managers approve orders up to 5,000, larger ones go to the director, and the buyer places and receives them.',
    blurb: 'Order lines, totals and budgets worked out for you. Who approves depends on the amount.',
    keys: ['purchase order', 'order line', 'line item', 'budget', 'department budget', 'approval limit', 'unit price', 'quantity'],
  },
  vet: {
    id: 'vet',
    title: 'Vet practice',
    icon: 'paw',
    accent: 'teal',
    sentence:
      'A vet practice books visits for pets without booking a vet twice at the same time. Vets record the treatments given, the app works out the bill, reception takes payments, and a visit closes only when nothing is owed.',
    blurb: 'Bookings that cannot clash, bills worked out from treatments, and a balance per visit.',
    keys: ['vet ', 'vets', 'veterinary', 'pet', 'pets', 'animal', 'treatment', 'double book'],
  },
  projects: {
    id: 'projects',
    title: 'Project planner',
    icon: 'tasks',
    accent: 'royalBlue',
    sentence:
      'An agency plans client projects with tasks, estimates and logged hours. The app works out progress, hours against the budget and whether each project is on track, and nobody is booked on two projects for the same days.',
    blurb: 'Tasks, logged hours, progress and health worked out. People are never booked twice.',
    keys: ['project', 'task', 'timesheet', 'logged hours', 'milestone', 'resource', 'capacity', 'agency'],
  },
  dispatch: {
    id: 'dispatch',
    title: 'Service dispatch',
    icon: 'wrench',
    accent: 'navy',
    sentence:
      'A repair company takes service jobs, the dispatcher schedules a technician without overlaps, technicians record labour hours and parts used, the app totals the cost, and a job can only be completed once the work is written up.',
    blurb: 'Jobs scheduled without clashes. Parts and labour are totalled before a job closes.',
    keys: ['dispatch', 'field service', 'technician', 'repair', 'call-out', 'callout', 'work order', 'engineer visit'],
  },
  sprints: {
    id: 'sprints',
    title: 'Sprint board and bug triage',
    icon: 'bug',
    accent: 'royalBlue',
    sentence:
      'A software team plans sprints from a backlog of stories and bugs. Each item has story points and a sprint cannot take more than its capacity. Testers report bugs by severity, a critical bug cannot be closed as won\u2019t fix, and only a tester marks work as done.',
    blurb: 'Story points against each sprint\u2019s capacity, bugs by severity, and nothing done until a tester checks it.',
    keys: ['sprint', 'backlog', 'story point', 'scrum', 'agile', 'bug', 'triage', 'tester', 'software team'],
  },
  billing: {
    id: 'billing',
    title: 'Timesheets and client billing',
    icon: 'clock',
    accent: 'teal',
    sentence:
      'A software house bills its clients by the hour. Developers log time on client projects, the project lead approves it, the app prices the hours at the project rate, and finance puts approved hours on invoices and records payments until nothing is owed.',
    blurb: 'Hours approved and priced at each project\u2019s rate, invoices totalled, and what every client still owes.',
    keys: ['timesheet', 'billable', 'invoice', 'billing', 'bills', 'hourly rate', 'by the hour', 'time tracking', 'log time'],
  },
  onboarding: {
    id: 'onboarding',
    title: 'Client onboarding',
    icon: 'rocket',
    accent: 'purple',
    sentence:
      'A software house onboards each new client: sales hands over the signed deal, the delivery lead books the kickoff, adds a checklist and a team, the client signs off the scope, and the client goes live only when every required step is done and the deposit is in.',
    blurb: 'A checklist and a team for each new client. Go-live waits for every required step and the deposit.',
    keys: [
      'onboard',
      'onboarding',
      'kickoff',
      'kick-off',
      'new client',
      'go live',
      'go-live',
      'handover',
      'hands over',
      'checklist',
      'deposit',
    ],
  },
};

export const HOME_TEMPLATES = TEMPLATES.concat(MORE_TEMPLATES, COMPLEX_TEMPLATES, SOFTWARE_NEW);
export function matchTemplate(text: string) {
  const s = ' ' + String(text || '').toLowerCase() + ' ';
  let best = null,
    score = 0;
  HOME_TEMPLATES.concat(QUESTS).forEach((id) => {
    const n = CARDS[id].keys.filter((k) => s.indexOf(k) >= 0).length;
    if (n > score) {
      score = n;
      best = id;
    }
  });
  return best;
}

let saved: Promise<unknown> | null = null;
/** Load the saved builds into REC (src/workspace/registry.ts). Starts once; later calls share the same promise. */
export const loadSaved = () => (saved ??= import('./saved'));
