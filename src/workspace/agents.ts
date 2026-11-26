import type { AgentInfo, Dict } from '@/shared/types/workspace';

// The builder agents. Other modules add to this registry (tester.tsx adds the Tester).
export const AGENTS: Dict<AgentInfo> = {
  orchestrator: {
    name: 'Orchestrator',
    icon: 'flow',
    acc: 'blue',
    role: 'Code, not a model. Runs the stations in order and checks every handoff.',
  },
  researcher: {
    name: 'Researcher',
    icon: 'search',
    acc: 'purple',
    role: 'Turns the sentence into a brief',
  },
  database: {
    name: 'Database',
    icon: 'database',
    acc: 'teal',
    role: 'Creates SQLite tables and seed data',
  },
  backend: {
    name: 'Backend',
    icon: 'server',
    acc: 'pumpkin',
    role: 'Writes the workflow, endpoints and access rules',
  },
  views: {
    name: 'View advisor',
    icon: 'pie',
    acc: 'royalBlue',
    role: 'Recommends how each table should be viewed and designs the dashboard',
  },
  ui: {
    name: 'UI',
    icon: 'layout',
    acc: 'pink',
    role: 'Lays out screens for each role and writes the tour',
  },
};
