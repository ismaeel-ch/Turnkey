/*
 * The command palette (Ctrl/Cmd+K) and the keyboard shortcuts dialog ("?"). This file loads the first time either
 * opens, so it adds nothing to the page's first load.
 *
 * The palette follows the ARIA combobox pattern: focus stays in the search box, the arrow keys move the active option
 * (aria-activedescendant), Enter runs it, Escape closes the dialog.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@fluentui/react-components';
import { keyLabel, rankCommands } from '@/platform/command-match';
import { closeDialog, cx } from './core';
import { Btn, Dialog, Icon, Switch } from './ui';
import { type Command, SHORTCUTS, commandsNow, openPalette, setSingleKeys, singleKeysOn } from './commands';

const apple = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** A shortcut as keys on screen. "g b" is two keys pressed one after the other. */
export function Keys({ keys }: { keys: string }) {
  // the keys are read out as they show ("G then B", "Ctrl+K"); a span may not carry an aria-label of its own
  const parts = keyLabel(keys, apple());
  return (
    <span className="keys">
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && <span className="keys-then"> then </span>}
          <kbd className="kbd">{p}</kbd>
        </span>
      ))}
    </span>
  );
}

function run(c: Command) {
  closeDialog();
  c.run();
}

export function PaletteDialog() {
  // the list is read once, when the palette opens: running a command closes it
  const [all] = useState(commandsNow);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const shown = useMemo(() => rankCommands(all, q), [all, q]);
  const cur = Math.min(active, Math.max(0, shown.length - 1));
  const optId = (c: Command) => 'cmd-' + c.id;
  const box = useRef<HTMLInputElement>(null);

  // Fluent's dialog moves focus to its first button once it has opened; the search box takes it back
  useEffect(() => {
    const t = setTimeout(() => box.current?.focus(), 0);
    const f = requestAnimationFrame(() => box.current?.focus());
    return () => {
      clearTimeout(t);
      cancelAnimationFrame(f);
    };
  }, []);

  useEffect(() => {
    const c = shown[cur];
    if (c) document.getElementById(optId(c))?.scrollIntoView({ block: 'nearest' });
  }, [shown, cur]);

  /** Moves through or runs the commands; false for a key the palette leaves alone. */
  const move = (key: string, ctrl: boolean): boolean => {
    const n = shown.length;
    if (key === 'ArrowDown') setActive(n ? (cur + 1) % n : 0);
    else if (key === 'ArrowUp') setActive(n ? (cur - 1 + n) % n : 0);
    else if (key === 'Home' && ctrl) setActive(0);
    else if (key === 'End' && ctrl) setActive(Math.max(0, n - 1));
    else if (key === 'Enter') {
      if (shown[cur]) run(shown[cur]);
    } else return false;
    return true;
  };
  const moveNow = useRef(move);
  useLayoutEffect(() => {
    moveNow.current = move;
  });

  /*
   * Keys pressed in the moment after the palette opens must not be lost. Until the search box has had focus, Fluent's
   * dialog may have put focus on its close button, and the dialog that closed just before may hand focus back to the
   * page behind. Either way the keys belong to the palette: arrows and Enter act on the list, and a typed letter moves
   * focus to the search box so the letter lands there. Registered before the first paint, so no key slips past.
   */
  useLayoutEffect(() => {
    let had = false;
    const onFocus = () => {
      had = true;
    };
    const input = box.current;
    input?.addEventListener('focus', onFocus);
    const onDown = (e: globalThis.KeyboardEvent) => {
      const el = box.current;
      if (!el || e.target === el || e.defaultPrevented || e.altKey || e.metaKey) return;
      const t = e.target instanceof Node ? e.target : null;
      if (had && t && el.closest('.dialog')?.contains(t)) return; // the person moved on to a button in the palette
      if (moveNow.current(e.key, e.ctrlKey)) {
        e.preventDefault();
        e.stopPropagation();
        el.focus();
      } else if (e.key.length === 1 && !e.ctrlKey) el.focus();
    };
    document.addEventListener('keydown', onDown, true);
    return () => {
      input?.removeEventListener('focus', onFocus);
      document.removeEventListener('keydown', onDown, true);
    };
  }, []);

  // groups in the order their first command appears, so the best match leads
  const groups: { name: string; items: Command[] }[] = [];
  for (const c of shown) {
    const g = groups.find((x) => x.name === c.group);
    if (g) g.items.push(c);
    else groups.push({ name: c.group, items: [c] });
  }

  return (
    <Dialog title="Commands" onClose={closeDialog} cls="palette">
      <Input
        data-autofocus
        ref={box}
        className="palette-q"
        contentBefore={<Icon n="search" s="16" />}
        placeholder="Type a command or an app name"
        aria-label="Search commands"
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-list"
        aria-autocomplete="list"
        aria-activedescendant={shown[cur] ? optId(shown[cur]) : undefined}
        autoComplete="off"
        spellCheck={false}
        value={q}
        onChange={(_, d) => {
          setQ(d.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (move(e.key, e.ctrlKey)) e.preventDefault();
        }}
      />
      <div id="palette-list" role="listbox" aria-label="Commands" className="palette-list">
        {groups.map((g) => (
          <div key={g.name} role="group" aria-labelledby={'cmdg-' + g.name.replace(/\W/g, '')}>
            <div className="palette-group t-cap muted" id={'cmdg-' + g.name.replace(/\W/g, '')} role="presentation">
              {g.name}
            </div>
            {g.items.map((c) => {
              const on = shown[cur] === c;
              return (
                <div
                  key={c.id}
                  id={optId(c)}
                  role="option"
                  aria-selected={on}
                  className={cx('palette-opt', on && 'on')}
                  onMouseMove={() => !on && setActive(shown.indexOf(c))}
                  onClick={() => run(c)}
                >
                  <Icon n={c.icon} s="16" />
                  <span className="grow ellipsis">{c.title}</span>
                  {c.keys && <Keys keys={c.keys} />}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {!shown.length && (
        <p className="muted palette-none" role="status">
          No command matches “{q}”.
        </p>
      )}
      <p className="t-cap muted palette-hint">Up and down arrows to move, Enter to run, Escape to close.</p>
    </Dialog>
  );
}

export function ShortcutsDialog() {
  const on = singleKeysOn();
  return (
    <Dialog
      title="Keyboard shortcuts"
      onClose={closeDialog}
      cls="shortcuts"
      foot={
        <>
          <Btn
            className="btn"
            onClick={() => {
              closeDialog();
              openPalette();
            }}
          >
            Open the command palette
          </Btn>
          <Btn className="btn primary" onClick={closeDialog}>
            Done
          </Btn>
        </>
      }
    >
      <table className="keys-table">
        <thead>
          <tr>
            <th scope="col">Keys</th>
            <th scope="col">What it does</th>
          </tr>
        </thead>
        <tbody>
          {SHORTCUTS.map((s) => (
            <tr key={s.keys} className={cx(s.single && !on && 'is-off')}>
              <td>
                <Keys keys={s.keys} />
              </td>
              <td>
                {s.text}
                {s.single && !on ? ' (off)' : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted t-cap">Letters work when you are not typing in a box. Press G, then the letter, within a second and a half.</p>
      <Switch id="set-keys" text="Single-key shortcuts" on={on} onChange={setSingleKeys} />
    </Dialog>
  );
}
