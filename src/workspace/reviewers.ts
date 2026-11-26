/*
 * The review steps the owner can add to a workflow (data, security, insight, wording, normaliser, UI stylist) and
 * the ones they describe themselves. A leaf module: it imports only the agent list and types, so any module can read
 * REVIEWERS at load time without an import cycle (custom.tsx imports most of the workspace).
 */
import type { ReviewerInfo } from '@/shared/types/workspace';
import { AGENTS } from './agents';

/** A reviewer agent from the library, or one the owner described. */
export type Reviewer = ReviewerInfo;
export const REVIEWERS: Record<string, Reviewer> = {
  data: {
    name: 'Data reviewer',
    short: 'Data review',
    after: 'database',
    icon: 'dbSearch',
    acc: 'forest',
    reads: 'the tables',
    job: 'Reads the tables for gaps: nowhere to write notes, no date to plan by, thin sample data.',
  },
  security: {
    name: 'Security reviewer',
    short: 'Security review',
    after: 'backend',
    icon: 'shieldKey',
    acc: 'cranberry',
    reads: 'the access rules',
    job: 'Reads the access rules for rights that are wider than the user stories need.',
  },
  insight: {
    name: 'Insight reviewer',
    short: 'Insight review',
    after: 'views',
    icon: 'lightbulb',
    acc: 'lavender',
    reads: 'the views and the dashboard',
    job: 'Looks for questions the dashboard cannot answer yet.',
  },
  wording: {
    name: 'Wording reviewer',
    short: 'Wording review',
    after: 'screens',
    icon: 'textEdit',
    acc: 'steel',
    reads: 'the pages',
    job: 'Reads the pages the way a new user would: crowded menus, wide tables, raw labels.',
  },
};
REVIEWERS.normalize = {
  name: 'Normaliser',
  short: 'Normalise tables',
  after: 'database',
  icon: 'layer',
  acc: 'teal',
  reads: 'the tables and their rows',
  job: 'Tidies the tables: free text that repeats becomes a choice, and a fact kept in two places is kept in one.',
  auto: true,
};
REVIEWERS.style = {
  name: 'UI stylist',
  short: 'Style the UI',
  after: 'screens',
  icon: 'color',
  acc: 'pink',
  reads: 'the pages and the layout',
  job: 'Fits the layout to the app: compact rows for wide tables, navigation that suits the number of pages.',
  auto: true,
};
export const regStep = (id: string, r: Reviewer) => {
  r.id = id;
  REVIEWERS[id] = r;
  AGENTS['rv_' + id] = {
    name: r.name,
    icon: r.icon,
    acc: r.acc,
    role: r.job,
    reviewer: id,
  };
  return r;
};
Object.keys(REVIEWERS).forEach((id) => regStep(id, REVIEWERS[id]));
