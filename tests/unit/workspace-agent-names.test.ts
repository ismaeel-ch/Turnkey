import { describe, expect, it } from 'vitest';
import { AGENT_NAMES, teamFor } from '@/shared/plan';
import { AGENTS } from '@/workspace/agents';
import { REVIEWERS } from '@/workspace/reviewers';
import { agentThe, parseFlow, reviewPrompt } from '@/workspace/custom';
import { planFromSaved } from '@/workspace/interview';
import { HOME_TEMPLATES } from '@/workspace/builds';
import '@/workspace/tester';

/* An agent has one name for the owner: the plan, the Build steps, the chat, the timeline and the workflow all use it. */

const calls = (text: string) => {
  const p = parseFlow(text);
  return p && p.calls ? p.calls.map((c) => c.tool + ':' + Object.values(c.args || {}).join('/')).join('+') : p && p.review ? 'review:' + p.review : null;
};

describe('agent names', () => {
  it('the builder agents and the reviews a plan can add go by the names the plan shows', () => {
    for (const id of ['researcher', 'database', 'backend', 'views', 'ui', 'tester']) expect(AGENTS[id].name).toBe(AGENT_NAMES[id]);
    expect(REVIEWERS.security.name).toBe(AGENT_NAMES.security);
    expect(REVIEWERS.data.name).toBe(AGENT_NAMES.data);
    expect(agentThe('database')).toBe('The List builder');
    expect(agentThe('researcher', true)).toBe('the Planner');
  });

  it('every saved build names in its plan only agents the workspace knows by that name', () => {
    const known = new Set([...Object.values(AGENTS).map((a) => a.name), ...Object.values(REVIEWERS).map((r) => r.name)]);
    for (const tpl of HOME_TEMPLATES) {
      const t = teamFor(planFromSaved(tpl, 0));
      for (const s of t.steps) if (s.by === 'agent') expect(known.has(s.who), tpl + ': ' + s.who).toBe(true);
      for (const r of t.reviews) expect(known.has(r.who), tpl + ': ' + r.who).toBe(true);
    }
  });

  it('chat understands the new names as well as the old ones', () => {
    expect(calls('Tell the Screen designer to keep page names short')).toBe('set_note:ui/Keep page names short');
    expect(calls('Tell the UI agent to keep page names short')).toBe('set_note:ui/Keep page names short');
    expect(calls('Tell the planner to keep it to three roles')).toBe('set_note:researcher/Keep it to three roles');
    expect(calls('Tell the list builder to add a notes field')).toBe('set_note:database/Add a notes field');
    expect(calls('Tell the rules builder to keep deletes for managers')).toBe('set_note:backend/Keep deletes for managers');
    expect(calls('Add an access check')).toBe('add_review:security');
    expect(calls('Add a list check')).toBe('add_review:data');
    expect(calls('Remove the access check')).toBe('remove_review:security');
    expect(calls('Add a security review')).toBe('add_review:security');
    expect(calls('Run the access check again')).toBe('review:security');
  });

  it('a review prompt keeps the role name the server recognises', () => {
    const app = { name: 'X', def: { brief: { roles: [], stories: [] }, tables: [], access: {}, process: null, theme: {} }, flow: null } as never;
    expect(reviewPrompt(app, 'security')).toMatch(/^You are the Security reviewer agent on Turnkey/);
    expect(reviewPrompt(app, 'data')).toMatch(/^You are the Data reviewer agent on Turnkey/);
  });
});
