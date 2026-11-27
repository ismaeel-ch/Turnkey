/* The words of the first welcome screen. The server draws them as plain HTML before any script loads
   (src/app/(workspace)/BootScreen.tsx), and the workspace draws the same words once it starts (Onboarding in
   src/workspace/shell-c.tsx), so a phone shows the welcome at once instead of after the whole workspace has run. */
export const WELCOME_STEPS = ['Welcome', 'Your account', 'How to run', 'First app', 'Ready'];
export const WELCOME_TITLE = 'Say what the work is. Get the whole app, ready to use.';
/** Follows the product name. */
export const WELCOME_LEAD =
  ' turns one sentence into a working business app. Five builder agents and a Tester make its database, rules, screens and tests while you watch, and code checks every handoff.';
export const WELCOME_NOTE = 'An entry for the SSI Agent-A-Thon 2026. People and records in it are made up.';
