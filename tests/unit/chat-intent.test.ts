import { describe, expect, it } from 'vitest';
import { releaseIntent, replyIntent } from '@/shared/chat-intent';

describe('releaseIntent', () => {
  it.each([
    ['release', null, false],
    ['Release it', null, false],
    ['release a new version', null, false],
    ['Please publish the app.', null, false],
    ['ship it as a fix', 'fix', false],
    ['release a patch', 'fix', false],
    ['Release version 1.1', null, false],
    ['release it as a new feature', 'feature', false],
    ['release again without changes', null, true],
    ['Release again', null, true],
    ['can you release the changes please', null, false],
    ['ok, release it now', null, false],
    ["let's release", null, false],
    ['new version', null, false],
    ['make a new release', null, false],
    ['time for a new version', null, false],
    ['release a major version', 'major', false],
  ])('reads "%s" as a release', (text, kind, again) => {
    expect(releaseIntent(text)).toEqual({ kind, again });
  });
  it.each([
    'Add a release date field to projects',
    'release date',
    'Rename the app to Release Desk',
    'Who can release a purchase order?',
    'Add a notes field to expenses',
    'Make it purple',
    '',
  ])('leaves "%s" to the change reader', (text) => {
    expect(releaseIntent(text)).toBeNull();
  });
});

describe('replyIntent', () => {
  it.each(['yes', 'Go ahead', 'ok', 'Looks good!', 'it works', 'yes please', 'approve'])('"%s" is a yes', (t) => {
    expect(replyIntent(t)).toBe('yes');
  });
  it.each(['no', 'Not now', 'cancel', 'still wrong', 'later'])('"%s" is a no', (t) => {
    expect(replyIntent(t)).toBe('no');
  });
  it.each(['yes but add a notes field too', 'Add a notes field', 'go back to 1.0'])('"%s" is neither', (t) => {
    expect(replyIntent(t)).toBeNull();
  });
});
