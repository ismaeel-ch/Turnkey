import { AGENT_NAMES } from '@/shared/plan/team';
import type { AgentInfo, Dict } from '@/shared/types/workspace';

// The builder agents. Other modules add to this registry (tester.tsx adds the Tester).
// Their names are the plain ones the owner sees on the plan and in the Build steps (AGENT_NAMES), so a chat card,
// the timeline and the steps list always name an agent the same way.
export const AGENTS: Dict<AgentInfo> = {
  orchestrator: {
    name: 'Orchestrator',
    icon: 'flow',
    acc: 'blue',
    role: 'Code, not a model. Runs the stations in order and checks every handoff.',
  },
  researcher: {
    name: AGENT_NAMES.researcher,
    icon: 'search',
    acc: 'purple',
    role: 'Turns your sentence and answers into a plan and a brief',
  },
  database: {
    name: AGENT_NAMES.database,
    icon: 'database',
    acc: 'teal',
    role: 'Sets up the lists and their demo data',
  },
  backend: {
    name: AGENT_NAMES.backend,
    icon: 'server',
    acc: 'pumpkin',
    role: 'Writes the stages, endpoints and who can see and do what',
  },
  views: {
    name: AGENT_NAMES.views,
    icon: 'pie',
    acc: 'royalBlue',
    role: 'Recommends how each table should be viewed and designs the dashboard',
  },
  ui: {
    name: AGENT_NAMES.ui,
    icon: 'layout',
    acc: 'pink',
    role: 'Lays out screens for each role and writes the tour',
  },
};
