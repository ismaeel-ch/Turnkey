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
    keys: ['helpdesk', 'ticket', 'support', 'it ', 'issue', 'incident', 'service desk', 'bug'],
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
};

export const HOME_TEMPLATES = TEMPLATES.concat(MORE_TEMPLATES);
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
