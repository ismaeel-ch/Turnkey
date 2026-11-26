import type { StationDef, WorkflowDefinition } from './types';

/** The six stations of the standard workflow, as in `STATIONS` in `src/legacy/line.js`. */
export const STATIONS: StationDef[] = [
  { id: 'research', name: 'Research', agent: 'researcher', asks: true },
  { id: 'database', name: 'Database', agent: 'database' },
  { id: 'backend', name: 'Backend', agent: 'backend', fallback: true },
  { id: 'views', name: 'Views', agent: 'views', fallback: true },
  { id: 'screens', name: 'Screens', agent: 'ui', fallback: true },
  { id: 'walkthrough', name: 'Walkthrough', agent: 'ui', fallback: true },
];

/** The standard workflow: no approvals, no added steps, three attempts. */
export function defaultWorkflow(): WorkflowDefinition {
  return { stations: STATIONS.map((s) => ({ ...s })), attempts: 3, approvals: [], steps: [], testerRounds: 3 };
}
