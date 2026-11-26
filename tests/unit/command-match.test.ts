import { describe, expect, it } from 'vitest';
import { keyLabel, keyName, rankCommands, scoreCommand } from '@/platform/command-match';

const cmds = [
  { title: 'Home', group: 'Go to', keywords: 'start new tab' },
  { title: 'Build view', group: 'Go to', keywords: 'watch the agents' },
  { title: 'Release view', group: 'Go to' },
  { title: 'Share by link', group: 'Share', keywords: 'send copy' },
  { title: 'Export build pack', group: 'Share', keywords: 'download' },
  { title: 'Use the dark theme', group: 'Theme', keywords: 'appearance' },
  { title: 'Stop the build', group: 'Build', keywords: 'cancel' },
];
const titles = (q: string) => rankCommands(cmds, q).map((c) => c.title);

describe('rankCommands', () => {
  it('keeps every command, in order, when nothing is typed', () => {
    expect(titles('')).toEqual(cmds.map((c) => c.title));
    expect(titles('   ')).toHaveLength(cmds.length);
  });
  it('puts a match at the start of the title first', () => {
    expect(titles('build')[0]).toBe('Build view');
    expect(titles('build')).toEqual(expect.arrayContaining(['Export build pack', 'Stop the build']));
  });
  it('finds a command by its group or keywords', () => {
    expect(titles('download')).toEqual(['Export build pack']);
    expect(titles('theme')).toEqual(['Use the dark theme']);
    expect(titles('cancel')).toEqual(['Stop the build']);
  });
  it('needs every word typed to match', () => {
    expect(titles('share link')).toEqual(['Share by link']);
    expect(titles('share zebra')).toEqual([]);
  });
  it('ignores case and punctuation', () => {
    expect(titles('RELEASE!')).toEqual(['Release view']);
  });
  it('matches inside a word as a last resort', () => {
    expect(scoreCommand(cmds[3], 'ink')).toBeGreaterThan(0);
    expect(scoreCommand(cmds[3], 'link')).toBeGreaterThan(scoreCommand(cmds[3], 'ink'));
  });
});

describe('keyName', () => {
  it('names Ctrl+K and Cmd+K the same', () => {
    expect(keyName({ key: 'k', ctrlKey: true })).toBe('mod+k');
    expect(keyName({ key: 'K', metaKey: true })).toBe('mod+k');
    expect(keyName({ key: 'K', metaKey: true, shiftKey: true })).toBe('mod+shift+k');
  });
  it('folds Shift into the character it types', () => {
    expect(keyName({ key: '?', shiftKey: true })).toBe('?');
    expect(keyName({ key: 'g' })).toBe('g');
  });
  it('leaves Alt combinations and lone modifiers alone', () => {
    expect(keyName({ key: 'g', altKey: true })).toBeNull();
    expect(keyName({ key: 'k', ctrlKey: true, altKey: true })).toBeNull();
    expect(keyName({ key: 'Shift', shiftKey: true })).toBeNull();
    expect(keyName({ key: 'Dead' })).toBeNull();
    expect(keyName({ key: '' })).toBeNull();
  });
  it('passes named keys through', () => {
    expect(keyName({ key: 'Escape' })).toBe('Escape');
  });
});

describe('keyLabel', () => {
  it('writes the modifier for the keyboard in use', () => {
    expect(keyLabel('mod+k', false)).toEqual(['Ctrl+K']);
    expect(keyLabel('mod+k', true)).toEqual(['⌘K']);
  });
  it('splits a sequence into its keys', () => {
    expect(keyLabel('g b', false)).toEqual(['G', 'B']);
    expect(keyLabel('?', true)).toEqual(['?']);
  });
});
