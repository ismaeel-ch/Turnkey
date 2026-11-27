/*
 * Which face of the Build tab an app shows. Kept apart from the list of steps (steps-view.tsx), which loads on first
 * use, because the shell and the command palette ask this before any app is open.
 */
import type { AppRecord } from '@/shared/types/workspace';
import { S, U, commit } from './core';

/** The plain steps, or one of the four views of how it was built. */
export const buildMode = (app: AppRecord): string => U.bview[app.id] || (S.settings.buildDetail ? 'line' : 'steps');
/** Open or close "how it was built" for this app. The choice is remembered for the next app and the next visit. */
export function showHow(app: AppRecord, on: boolean) {
  U.bview[app.id] = on ? 'line' : 'steps';
  S.settings.buildDetail = on;
  commit();
}
