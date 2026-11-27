import {
  Children,
  Fragment,
  cloneElement,
  createElement,
  forwardRef,
  isValidElement,
  useEffect,
  useRef,
  type CSSProperties,
  type ChangeEvent,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import type {
  ButtonProps,
  CardProps,
  InputProps as FluentInputProps,
  MessageBarIntent,
  SelectProps as FluentSelectProps,
  SwitchProps,
  TextareaProps as FluentTextareaProps,
} from '@fluentui/react-components';
import type { Check } from '@/shared/types/app';
import {
  Button,
  Card as FluentCard,
  Input as FluentInput,
  InteractionTag,
  InteractionTagPrimary,
  InteractionTagSecondary,
  Select as FluentSelect,
  Textarea as FluentTextarea,
  Menu as FluentMenu,
  MenuDivider,
  MenuGroupHeader,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  Switch as FluentSwitch,
  Tab,
  TabList,
  Field as FluentField,
  Dialog as FluentDialog,
  DialogBody,
  DialogContent,
  DialogActions,
  DialogSurface,
  DialogTitle,
  Spinner as FluentSpinner,
  ToggleButton,
} from '@fluentui/react-components';
import { NativeField } from '@/platform/dom';
import { ICONS } from './icons';
import { accFor, cx, initials } from './core';
import { AGENTS } from './line';
import { DIALOG_EXIT, useDialogOpen } from './motion';

/* ===== Turnkey prototype · small Fluent-style building blocks ===== */
/** A class name part that may be left out. */
type Cls = string | false | null | undefined;
export function Icon({ n, s, cls }: { n: string; s?: string | number; cls?: Cls }) {
  return (
    <svg
      className={cx('ic', s && 's' + s, cls)}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      dangerouslySetInnerHTML={{
        __html: (ICONS as Record<string, string>)[n] || ICONS.circle,
      }}
    />
  );
}
export function Logo({ size }: { size?: number }) {
  const z = size || 22;
  return (
    <svg className="logo" width={z} height={z} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="2" width="13" height="5" rx="1.5" fill="var(--ag-purple)" />
      <rect x="17" y="2" width="5" height="13" rx="1.5" fill="var(--ag-teal)" />
      <rect x="9" y="17" width="13" height="5" rx="1.5" fill="var(--ag-pumpkin)" />
      <rect x="2" y="9" width="5" height="13" rx="1.5" fill="var(--ag-pink)" />
      <rect x="9" y="9" width="6" height="6" rx="1.5" fill="var(--colorNeutralForeground1)" />
    </svg>
  );
}
export function Avatar({ name, size, acc }: { name: string; size?: string; acc?: string }) {
  return (
    <span className={cx('av', size && 'av-' + size, 'acc-' + (acc || accFor(name)))} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
export function AgentAv({ id, size }: { id: string; size?: string }) {
  const a = AGENTS[id];
  if (!a) return <Avatar name="You" size={size} acc="steel" />;
  return (
    <span className={cx('av sq', size && 'av-' + size, 'acc-' + a.acc)} title={a.name + ' agent'}>
      <Icon n={a.icon} s={size === 'xs' ? '12' : size === 'lg' ? '24' : '16'} />
    </span>
  );
}
/** Fluent's spinner, small enough to sit in a line of text. */
export function Spinner() {
  return <FluentSpinner className="spin" size="extra-tiny" role="status" aria-label="Working" />;
}
/**
 * Every button in the workspace. The old class names stay on the element (`btn primary sm`, `btn subtle icon` ...)
 * because tests and layout CSS use them; they also pick the Fluent appearance and size.
 */
export const Btn = forwardRef<HTMLButtonElement | HTMLAnchorElement, ButtonProps>(function Btn({ className, children, ...rest }, ref) {
  const t = String(className || '').split(/\s+/);
  const has = (x: string) => t.includes(x);
  const appearance = has('primary') || has('danger') ? 'primary' : has('subtle') ? 'subtle' : 'secondary';
  // `.btn.icon` holds only an icon. Fluent sizes an icon-only button square when the icon comes in its `icon` slot;
  // as a child it keeps the 64px minimum width and the text line height (a 64x20 close button on a toast).
  const iconOnly = has('icon') && isValidElement(children);
  return (
    <Button
      ref={ref}
      className={className}
      appearance={appearance}
      size={has('sm') ? 'small' : has('lg') ? 'large' : 'medium'}
      icon={iconOnly ? children : undefined}
      {...rest}
    >
      {iconOnly ? undefined : children}
    </Button>
  );
});
/**
 * Fluent's Switch inside a `label.switch`, so a click on the text toggles it too and tests can find it by class.
 * Its input is a NativeField, like every other field here: one native `change` per toggle.
 */
/*
 * Text boxes, dropdowns and text areas: Fluent's Input, Select and Textarea around the native element.
 * Module code reads values from the DOM and listens for the browser's `change` event, so:
 * - `className`, `id`, `name`, `data-*`, `aria-*` and every other native prop stay on the native element
 *   (tests and CSS find `.input`, `#id`); `size`, `appearance` and `cls` go to Fluent's frame.
 * - Fluent never takes over the value: without a `value` prop the field is uncontrolled.
 * - `native` renders the element as a NativeField (commit-time `change`, value written only when it differs),
 *   for code that used NativeField before. Without it the element is a plain React field.
 */
const fieldSize = (className: string | undefined) => {
  const t = String(className || '').split(/\s+/);
  return t.includes('sm') ? 'small' : t.includes('lg') ? 'large' : 'medium';
};
type SlotProps = Record<string, unknown> & { className?: string };
/** Draws the native field inside Fluent's frame: Fluent's props plus ours, and `value` only when the caller gave one. */
function renderField(
  tag: 'input' | 'select' | 'textarea',
  props: FieldProps,
  className: string | undefined,
  native: boolean | undefined,
  ref: Ref<unknown>,
  p: SlotProps,
) {
  const q: Record<string, unknown> = { ...p, className: cx(p.className, className), ref };
  if (!('value' in props)) {
    delete q.value;
    if ('defaultValue' in props) q.defaultValue = props.defaultValue;
  }
  return native ? <NativeField as={tag} {...q} /> : createElement(tag, q);
}
/**
 * The props of a text box, dropdown or text area: the native element's own, plus `cls` and `appearance` for Fluent's
 * frame and `native` (see above).
 */
type FieldProps = {
  className?: string;
  cls?: string;
  native?: boolean;
  appearance?: string;
  style?: CSSProperties;
  // the native element's change event; which element depends on the field
  onChange?: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void;
  value?: unknown;
  defaultValue?: unknown;
};
export type InputProps = FieldProps & Omit<InputHTMLAttributes<HTMLInputElement>, keyof FieldProps | 'size'>;
export type SelectProps = FieldProps & Omit<SelectHTMLAttributes<HTMLSelectElement>, keyof FieldProps | 'size'>;
export type TextareaProps = FieldProps & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, keyof FieldProps>;
function splitFieldProps(props: FieldProps) {
  const { className, cls, native, appearance, style, onChange, ...rest } = props;
  return { className, cls, native, appearance, style, onChange, rest };
}
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(props, ref) {
  const { className, cls, native, appearance, style, onChange, rest } = splitFieldProps(props);
  return (
    <FluentInput
      className={cx('tk-field', 'tk-input', cls)}
      style={style}
      size={fieldSize(className)}
      appearance={(appearance || 'outline') as FluentInputProps['appearance']}
      onChange={onChange ? (e) => onChange(e) : undefined}
      // the slot's render function gets Fluent's props and adds ours
      input={
        {
          children: (_t: unknown, p: SlotProps) => renderField('input', props, className, native, ref, p),
        } as unknown as FluentInputProps['input']
      }
      // the native props go on to the field slot; Fluent's props types each field's value narrowly
      {...(rest as object)}
    />
  );
});
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(props, ref) {
  const { className, cls, native, appearance, style, onChange, rest } = splitFieldProps(props);
  return (
    <FluentSelect
      className={cx('tk-field', 'tk-select', cls)}
      style={style}
      size={fieldSize(className)}
      appearance={(appearance || 'outline') as FluentSelectProps['appearance']}
      onChange={onChange ? (e) => onChange(e) : undefined}
      // the slot's render function gets Fluent's props and adds ours
      select={{
        children: (_t: unknown, p: SlotProps) => renderField('select', props, className, native, ref, p),
      }}
      // the native props go on to the field slot; Fluent's props types each field's value narrowly
      {...(rest as object)}
    />
  );
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(props, ref) {
  const { className, cls, native, appearance, style, onChange, rest } = splitFieldProps(props);
  return (
    <FluentTextarea
      className={cx('tk-field', 'tk-textarea', cls)}
      style={style}
      size={fieldSize(className)}
      appearance={(appearance || 'outline') as FluentTextareaProps['appearance']}
      resize="vertical"
      onChange={onChange ? (e) => onChange(e) : undefined}
      // the slot's render function gets Fluent's props and adds ours
      textarea={{
        children: (_t: unknown, p: SlotProps) => renderField('textarea', props, className, native, ref, p),
      }}
      // the native props go on to the field slot; Fluent's props types each field's value narrowly
      {...(rest as object)}
    />
  );
});
/** A filter or suggestion chip: Fluent's circular small button (a toggle when `on` is given). */
export const Chip = forwardRef<HTMLButtonElement, ButtonProps & { on?: boolean }>(function Chip({ className, on, children, ...rest }, ref) {
  const C = (on === undefined ? Button : ToggleButton) as typeof Button;
  return (
    <C
      ref={ref}
      className={cx('chip', on && 'on', className)}
      shape="circular"
      size="small"
      appearance={on ? 'primary' : 'outline'}
      {...(on === undefined ? {} : { checked: !!on })}
      {...rest}
    >
      {children}
    </C>
  );
});
/** A chip for an active filter, with its own remove button (`.chip-x`): Fluent's InteractionTag. */
export function FilterChip({ children, onRemove, removeLabel }: { children: ReactNode; onRemove: () => void; removeLabel: string }) {
  return (
    <InteractionTag className="chip on" shape="circular" size="small" appearance="brand">
      <InteractionTagPrimary hasSecondaryAction>{children}</InteractionTagPrimary>
      <InteractionTagSecondary className="chip-x" aria-label={removeLabel} onClick={onRemove} />
    </InteractionTag>
  );
}
/**
 * Fluent's Card as a plain container. Pass the old classes (`card tpl` ...): workspace.css resets Fluent's own padding
 * and gap on `.card.fui-Card` and restates each card's layout, so Fluent draws the surface and the layout stays.
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card({ className, children, ...rest }, ref) {
  return (
    <FluentCard ref={ref} className={className} appearance={/\bflat\b/.test(className || '') ? 'outline' : 'filled'} {...rest}>
      {children}
    </FluentCard>
  );
});
export function Switch({
  on,
  onChange,
  text,
  id,
  disabled,
  title,
  label,
}: {
  on?: boolean;
  onChange: (on: boolean) => void;
  text?: ReactNode;
  id?: string;
  disabled?: boolean;
  title?: string;
  /** the switch's name when it shows no text of its own */
  label?: string;
}) {
  return (
    <label className={cx('switch', disabled && 'is-off')} title={title}>
      <FluentSwitch
        id={id}
        aria-label={text ? undefined : label}
        checked={!!on}
        disabled={disabled}
        onChange={(e, d) => onChange(d.checked)}
        // Fluent types slot render functions narrowly; this one passes Fluent's own props through unchanged
        input={
          {
            children: (_tag: unknown, props: Record<string, unknown>) => <NativeField as="input" {...props} />,
          } as unknown as SwitchProps['input']
        }
      />
      {text && <span className="switch-t">{text}</span>}
    </label>
  );
}
/** Fluent's TabList. Each tab keeps `.tab` (and `.on` when selected) for layout CSS and tests. */
/** One tab of `Tabs`, or one button of `Seg`. */
export interface TabItem {
  id: string;
  label: ReactNode;
  title?: string;
  icon?: string;
  tour?: string;
  count?: number | null;
}
export function Tabs({
  items,
  value,
  onChange,
  cls,
  label: aria,
}: {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  cls?: string;
  label?: string;
}) {
  const small = String(cls || '')
    .split(/\s+/)
    .includes('sm');
  return (
    <TabList
      className={cx('tabs', cls)}
      aria-label={aria}
      size={small ? 'small' : 'medium'}
      selectedValue={value}
      onTabSelect={(e, d) => onChange(String(d.value))}
    >
      {items.map((it) => (
        <Tab
          key={it.id}
          value={it.id}
          className={cx('tab', it.id === value && 'on')}
          data-tour={it.tour}
          title={it.title}
          icon={it.icon ? <Icon n={it.icon} /> : undefined}
        >
          <span className="tab-t">{it.label}</span>
          {it.count != null && <span className="tab-n">{it.count}</span>}
        </Tab>
      ))}
    </TabList>
  );
}
export function Seg({
  items,
  value,
  onChange,
  label: aria,
}: {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  label?: string;
}) {
  return (
    <div className="seg" role="group" aria-label={aria}>
      {items.map((it) => (
        <ToggleButton
          key={it.id}
          appearance="subtle"
          shape="square"
          size="medium"
          checked={it.id === value}
          className={cx(it.id === value && 'on')}
          title={it.title}
          icon={it.icon ? <Icon n={it.icon} s="16" /> : undefined}
          onClick={() => onChange(it.id)}
        >
          {it.label}
        </ToggleButton>
      ))}
    </div>
  );
}
export const TONE_ICON: Record<string, string> = {
  info: 'info',
  success: 'checkCircle',
  warning: 'warning',
  danger: 'errorCircle',
};
const TONE_INTENT: Record<string, MessageBarIntent> = { info: 'info', success: 'success', warning: 'warning', danger: 'error' };
/** Fluent's MessageBar. `cls="bar"` makes it a full-width strip with square corners. */
export function MBar({ tone, children, action, cls }: { tone?: string; children?: ReactNode; action?: ReactNode; cls?: string }) {
  const t = tone || 'info';
  return (
    <MessageBar
      className={cx('mbar', 'm-' + t, cls)}
      intent={TONE_INTENT[t] || 'info'}
      shape={
        String(cls || '')
          .split(/\s+/)
          .includes('bar')
          ? 'square'
          : 'rounded'
      }
      role={t === 'danger' || t === 'warning' ? 'alert' : 'status'}
      icon={<Icon n={TONE_ICON[t]} />}
    >
      <MessageBarBody className="grow">{children}</MessageBarBody>
      {action && <MessageBarActions>{action}</MessageBarActions>}
    </MessageBar>
  );
}
export function Empty({ icon, title, text, children }: { icon?: string; title: ReactNode; text?: ReactNode; children?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-ic">
        <Icon n={icon || 'info'} s="24" />
      </span>
      <strong>{title}</strong>
      {text && <p className="muted">{text}</p>}
      {children}
    </div>
  );
}
/**
 * Fluent's Menu, drawn in place (`inline`) rather than in a portal, so `.menu-wrap > button` and `.menu .mi` stay
 * inside the toolbar that owns them. Items: `'-'` divider, `{ head, label }` heading, or
 * `{ label, icon, hint, check, danger, disabled, on }`.
 */
/** One entry of a `Menu`. */
export interface MenuEntry {
  label: ReactNode;
  head?: boolean;
  icon?: string;
  hint?: string;
  check?: boolean;
  danger?: boolean;
  disabled?: boolean;
  on?: () => void;
  /** A submenu that opens beside this item, for a long list of choices. */
  sub?: (MenuEntry | '-')[];
}
/** One entry of a menu list: a divider, a group heading, an item, or an item that opens a submenu. */
function menuEntry(it: MenuEntry | '-', i: number): ReactNode {
  if (it === '-') return <MenuDivider key={i} className="msep" />;
  if (it.head)
    return (
      <MenuGroupHeader key={i} className="mlabel">
        {it.label}
      </MenuGroupHeader>
    );
  const item = (
    <MenuItem
      key={i}
      className={cx('mi', it.danger && 'danger')}
      disabled={it.disabled}
      icon={it.icon ? <Icon n={it.icon} /> : undefined}
      secondaryContent={it.hint || undefined}
      onClick={() => {
        if (it.on) it.on();
      }}
    >
      <span className="mi-row">
        <span className="grow">{it.label}</span>
        {it.check && <Icon n="check" s="16" />}
      </span>
    </MenuItem>
  );
  if (!it.sub) return item;
  return (
    // not inline: inside the parent's scrolling list, the submenu would be pushed back over the parent
    <FluentMenu key={i} positioning={{ position: 'after', align: 'top', offset: 2 }}>
      <MenuTrigger disableButtonEnhancement>{item}</MenuTrigger>
      <MenuPopover className="menu sub">
        <MenuList>{it.sub.map(menuEntry)}</MenuList>
      </MenuPopover>
    </FluentMenu>
  );
}
export function Menu({
  btn,
  items,
  align,
  title,
  tour,
}: {
  btn: { cls?: string; label?: string; body: ReactNode };
  items: (MenuEntry | '-' | false | null | undefined)[];
  align?: string;
  title?: string;
  tour?: string;
}) {
  const list = items.filter((it): it is MenuEntry | '-' => !!it);
  return (
    <div className="menu-wrap">
      <FluentMenu
        inline
        hasIcons={list.some((it) => it !== '-' && !!it.icon)}
        positioning={{ position: 'below', align: align === 'left' ? 'start' : 'end', offset: 4 }}
      >
        <MenuTrigger disableButtonEnhancement>
          <Btn className={btn.cls || 'btn subtle'} title={title} aria-label={btn.label || undefined} data-tour={tour}>
            {btn.body}
          </Btn>
        </MenuTrigger>
        <MenuPopover className={cx('menu', align === 'left' ? 'left' : 'right')}>
          <MenuList>{list.map(menuEntry)}</MenuList>
        </MenuPopover>
      </FluentMenu>
    </div>
  );
}
/** Moves focus into a dialog when it opens: the marked field, else the first field, else the main button. */
function FocusOnOpen() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current && ref.current.closest<HTMLElement>('.dialog');
    if (!el) return;
    const f =
      el.querySelector<HTMLElement>('[data-autofocus]') ||
      el.querySelector<HTMLElement>('.dbody input, .dbody select, .dbody textarea') ||
      el.querySelector<HTMLElement>('.dfoot .btn.primary') ||
      el;
    try {
      f.focus();
    } catch {}
  }, []);
  return <span ref={ref} hidden />;
}
/**
 * Fluent hides everything behind a modal dialog (aria-hidden on the page root). Our dialogs are removed by the store,
 * not closed through Fluent, and the hiding was left in place, so screen readers and role queries lost the page.
 * Once the last dialog is gone, undo it on the page root.
 */
function useRestorePage() {
  useEffect(
    () => () => {
      const sweep = () => {
        if (document.querySelector('.dialog')) return;
        const r = document.getElementById('root');
        if (r && r.getAttribute('aria-hidden') === 'true') r.removeAttribute('aria-hidden');
      };
      setTimeout(sweep, 0);
      setTimeout(sweep, 300);
    },
    [],
  );
}
/**
 * A ref for a box that may scroll: while its content overflows, it is a Tab stop, so keyboard users can scroll it
 * (WCAG 2.1.1). It stops being one when everything fits.
 */
export function scrollStop(el: HTMLElement | null) {
  if (!el || typeof ResizeObserver === 'undefined') return;
  const fit = () => {
    if (el.scrollHeight > el.clientHeight + 1) el.tabIndex = 0;
    else el.removeAttribute('tabindex');
  };
  fit();
  new ResizeObserver(fit).observe(el);
}
/* ---------- keeping the keyboard's place ----------
   When the button someone pressed disappears (an answered question, a closed card, a bar that changes), the browser
   drops focus to the top of the page, and a keyboard or screen reader user has to find their place again. These move
   focus to what came in its place, but only when focus was lost: they never take it from a field in use elsewhere. */
// a page that has just loaded has not lost anything: focus starts at the top, where the skip link is
let used = false;
if (typeof window !== 'undefined')
  ['pointerdown', 'keydown'].forEach((t) =>
    window.addEventListener(
      t,
      () => {
        used = true;
      },
      { capture: true, once: true },
    ),
  );
const focusLost = () => {
  if (!used) return false;
  const a = document.activeElement;
  return !a || a === document.body || !a.isConnected;
};
const shown = (el: Element | null): el is HTMLElement => !!el && el instanceof HTMLElement && el.getClientRects().length > 0;
/**
 * Once the screen has changed, focuses the first of `targets` (selectors, in order of preference) that is on the
 * page, if focus was lost. Tries for a short while, as the new part may draw a moment later (after a dialog closes).
 * A target that cannot take focus by itself (a heading, a region) is made focusable from script only.
 */
export function refocus(targets: string[], within?: ParentNode | null) {
  if (typeof document === 'undefined') return;
  let n = 0;
  const look = () => {
    // a dialog on its way out still holds the focus for a moment: wait for it to go
    if (document.activeElement?.closest('[data-closing]')) return void (++n < 24 && setTimeout(look, 50));
    if (!focusLost()) return;
    const root = within && (within as Node).isConnected ? within : document;
    for (const sel of targets) {
      const el = root.querySelector(sel);
      if (shown(el)) {
        if (el.tabIndex < 0 && !el.hasAttribute('tabindex')) el.tabIndex = -1;
        el.focus();
        return;
      }
    }
    if (++n < 12) setTimeout(look, 50);
  };
  setTimeout(look, 0);
}
/**
 * A ref for the heading of a part that replaces what was pressed (the next question, the plan, the build's steps):
 * when it appears and focus was lost, focus moves to it, so the keyboard carries on from there and a screen reader
 * reads it out.
 */
export function useFocusOnArrive<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && focusLost()) el.focus();
  }, []);
  return ref;
}
/* Fluent 2 on the buttons of a dialog (the same holds for a drawer and for a form in a built app):
   - the main action comes first, to the left of the others, and there is one main action at most;
   - a Close icon in the corner is for a dialog with no button that closes it: next to Cancel or Close it is redundant. */
const flat = (n: ReactNode): ReactNode[] =>
  Children.toArray(n).flatMap((c) => (isValidElement<{ children?: ReactNode }>(c) && c.type === Fragment ? flat(c.props.children) : [c]));
const classOf = (c: ReactNode) => (isValidElement<{ className?: string }>(c) ? String(c.props.className || '').split(/\s+/) : []);
const isMain = (c: ReactNode) => classOf(c).includes('primary') || classOf(c).includes('danger');
const textOf = (c: ReactNode): string =>
  typeof c === 'string' || typeof c === 'number'
    ? String(c)
    : isValidElement<{ children?: ReactNode }>(c)
      ? Children.toArray(c.props.children).map(textOf).join('')
      : '';
const CLOSES = /^(close|cancel|done|not now|got it)$/i;
/** A row of actions in Fluent's order: the main one first, the rest as written. */
export function actionOrder(actions: ReactNode): ReactNode[] {
  const all = flat(actions);
  return [...all.filter(isMain), ...all.filter((c) => !isMain(c))];
}
export function Dialog({
  title,
  children,
  foot,
  onClose,
  wide,
  cls,
  x,
}: {
  title: ReactNode;
  children?: ReactNode;
  foot?: ReactNode;
  onClose?: () => void;
  wide?: boolean;
  cls?: string;
  /** The Close icon in the corner. Left out, it shows only when no button in the footer closes the dialog. */
  x?: boolean;
}) {
  useRestorePage();
  // false while the dialog plays its way out, after the store has let go of it (motion.tsx)
  const open = useDialogOpen();
  const acts = foot ? actionOrder(foot) : [];
  const corner = x ?? !acts.some((c) => CLOSES.test(textOf(c).trim()));
  return (
    <FluentDialog
      open={open}
      surfaceMotion={DIALOG_EXIT}
      modalType="modal"
      onOpenChange={(e, d) => {
        if (open && !d.open && onClose) onClose();
      }}
    >
      <DialogSurface className={cx('dialog', wide && 'wide', cls)} backdropMotion={DIALOG_EXIT} data-closing={open ? undefined : ''}>
        <DialogBody className={cx('dlg', !acts.length && 'no-foot')}>
          <div className="dhead">
            <DialogTitle as="h2" className="t-sub1 grow">
              {title}
            </DialogTitle>
            {onClose && corner && (
              <Btn className="btn subtle icon" aria-label="Close" onClick={onClose}>
                <Icon n="dismiss" />
              </Btn>
            )}
          </div>
          <DialogContent className="dbody" ref={scrollStop} role="region" aria-label="Dialog content">
            {children}
          </DialogContent>
          {acts.length > 0 && <DialogActions className="dfoot">{acts}</DialogActions>}
        </DialogBody>
        <FocusOnOpen />
      </DialogSurface>
    </FluentDialog>
  );
}
export function Field({
  label: text,
  hint,
  error,
  id,
  children,
  cls,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  id?: string;
  children?: ReactNode;
  cls?: string;
}) {
  return (
    <FluentField
      className={cx('field', error && 'has-err', cls)}
      label={text ? { children: text, htmlFor: id } : undefined}
      hint={!error && hint ? { className: 'field-hint', children: hint } : undefined}
      validationState={error ? 'error' : 'none'}
      validationMessage={error ? { className: 'field-err', children: error } : undefined}
    >
      {(p) =>
        isValidElement<Record<string, unknown>>(children) &&
        (typeof children.type === 'function' || /^(input|select|textarea)$/.test(String(children.type)))
          ? cloneElement(children, {
              id: children.props.id || p.id,
              'aria-describedby': children.props['aria-describedby'] || p['aria-describedby'],
              'aria-invalid': p['aria-invalid'],
            })
          : children
      }
    </FluentField>
  );
}
export function Json({ v, k, open }: { v: unknown; k?: string | number | null; open?: boolean }) {
  if (v === null || typeof v !== 'object')
    return (
      <div className="jrow">
        {k != null && (
          <span className="jk">
            {k}
            {': '}
          </span>
        )}
        <span className={'jv j-' + (v === null ? 'null' : typeof v)}>
          {typeof v === 'string' ? '"' + (v.length > 180 ? v.slice(0, 180) + '…' : v) + '"' : String(v)}
        </span>
      </div>
    );
  const keys = Object.keys(v);
  return (
    <details
      className="jnode"
      ref={(el: (HTMLDetailsElement & { __init?: number }) | null) => {
        if (el && open && !el.__init) {
          el.__init = 1;
          el.open = true;
        }
      }}
    >
      <summary>
        {k != null && <span className="jk">{k} </span>}
        <span className="muted">{Array.isArray(v) ? '[' + keys.length + ']' : '{' + keys.length + '}'}</span>
      </summary>
      {keys.slice(0, 80).map((x) => (
        <Json key={x} v={(v as Record<string, unknown>)[x]} k={x} />
      ))}
    </details>
  );
}
export function CheckList({ checks }: { checks?: Check[] | null }) {
  if (!checks || !checks.length) return <p className="muted">No checks have run yet.</p>;
  return (
    <ul className="checks">
      {checks.map((c, i) => (
        <li key={i} className={c.ok ? 'ok' : 'bad'}>
          <Icon n={c.ok ? 'checkCircle' : 'errorCircle'} />
          <div>
            <div className="t-strong">{c.label}</div>
            {c.detail && <div className="muted t-cap">{c.detail}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}
export const STATUS_META: Record<string, { text: string; tone: string }> = {
  idle: {
    text: 'Waiting',
    tone: 'neutral',
  },
  working: {
    text: 'Working',
    tone: 'info',
  },
  checking: {
    text: 'Checking',
    tone: 'info',
  },
  ok: {
    text: 'Checked',
    tone: 'success',
  },
  sentback: {
    text: 'Sent back',
    tone: 'warning',
  },
  waiting: {
    text: 'Needs you',
    tone: 'warning',
  },
  failed: {
    text: 'Failed',
    tone: 'danger',
  },
};
export function Proto({ children }: { children?: ReactNode }) {
  return (
    <span className="proto" title="How this prototype differs from the real build">
      <Icon n="info" s="12" />
      {children}
    </span>
  );
}
