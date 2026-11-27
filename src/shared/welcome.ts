/* The words of the first welcome screen. The server draws them as plain HTML before any script loads
   (BootScreen in src/platform/boot-screen.tsx), and the workspace draws the same words once it starts (Onboarding in
   src/workspace/shell-c.tsx), so a phone shows the welcome at once instead of after the whole workspace has run. */
export const WELCOME_STEPS = ['Welcome', 'Your account', 'How to run', 'First app', 'Ready'];
export const WELCOME_TITLE = 'Say what the work is. Get the whole app, ready to use.';
/** Follows the product name. */
export const WELCOME_LEAD =
  ' turns one sentence into a working business app. Five builder agents and a Tester make its database, rules, screens and tests while you watch, and code checks every handoff.';
export const WELCOME_NOTE = 'People and records in it are made up.';
/** Under the two quick-start buttons. */
export const WELCOME_QUICK_NOTE =
  'Both use a demo account in this browser. Try a sample asks one question about a sales bidding desk, shows you the plan, then builds it in about 30 seconds with no model calls. Get started below sets up your own account first.';
/** The line of stations under the note: each station's name and the agent (an id in the workspace's AGENTS) that works it.
 *  The same as STATIONS in src/workspace/line.ts, which the server cannot load (a unit test keeps the two the same). */
export const WELCOME_STATIONS: ReadonlyArray<{ id: string; name: string; agent: string }> = [
  { id: 'research', name: 'Research', agent: 'researcher' },
  { id: 'database', name: 'Database', agent: 'database' },
  { id: 'backend', name: 'Backend', agent: 'backend' },
  { id: 'views', name: 'Views', agent: 'views' },
  { id: 'screens', name: 'Screens', agent: 'ui' },
  { id: 'walkthrough', name: 'Walkthrough', agent: 'ui' },
];
/** The three promises at the foot of the first screen: an icon name, the bold start and the rest. */
export const WELCOME_TICKS: ReadonlyArray<{ icon: string; lead: string; text: string }> = [
  { icon: 'eye', lead: 'Built in front of you.', text: ' Every agent step, tool call and check is visible.' },
  { icon: 'shield', lead: 'Checked at every handoff.', text: ' Agents write definitions. Code tests them and sends failures back.' },
  {
    icon: 'storage',
    lead: 'Yours, in this browser.',
    text: ' Apps and data stay here, work offline, and are still here when you sign in again.',
  },
];
