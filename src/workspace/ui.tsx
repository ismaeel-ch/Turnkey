// @ts-nocheck -- converted from the prototype; types are added module by module
import { cloneElement, forwardRef, isValidElement, useEffect, useRef } from 'react';
import {
  Button,
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

/* ===== Turnkey prototype · small Fluent-style building blocks ===== */
export function Icon({ n, s, cls }) {
  return (
    <svg
      className={cx('ic', s && 's' + s, cls)}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      dangerouslySetInnerHTML={{
        __html: ICONS[n] || ICONS.circle,
      }}
    />
  );
}
export function Logo({ size }) {
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
export function Avatar({ name, size, acc }) {
  return (
    <span className={cx('av', size && 'av-' + size, 'acc-' + (acc || accFor(name)))} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
export function AgentAv({ id, size }) {
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
export const Btn = forwardRef(function Btn({ className, children, ...rest }, ref) {
  const t = String(className || '').split(/\s+/);
  const has = (x) => t.includes(x);
  const appearance = has('primary') || has('danger') ? 'primary' : has('subtle') ? 'subtle' : 'secondary';
  return (
    <Button
      ref={ref}
      className={className}
      appearance={appearance}
      size={has('sm') ? 'small' : has('lg') ? 'large' : 'medium'}
      iconOnly={has('icon')}
      {...rest}
    >
      {children}
    </Button>
  );
});
/**
 * Fluent's Switch inside a `label.switch`, so a click on the text toggles it too and tests can find it by class.
 * Its input is a NativeField, like every other field here: one native `change` per toggle.
 */
export function Switch({ on, onChange, text, id, disabled, title }) {
  return (
    <label className={cx('switch', disabled && 'is-off')} title={title}>
      <FluentSwitch
        id={id}
        checked={!!on}
        disabled={disabled}
        onChange={(e, d) => onChange(d.checked)}
        input={{ children: (_tag, props) => <NativeField as="input" {...props} /> }}
      />
      {text && <span className="switch-t">{text}</span>}
    </label>
  );
}
/** Fluent's TabList. Each tab keeps `.tab` (and `.on` when selected) for layout CSS and tests. */
export function Tabs({ items, value, onChange, cls, label: aria }) {
  const small = String(cls || '')
    .split(/\s+/)
    .includes('sm');
  return (
    <TabList
      className={cx('tabs', cls)}
      aria-label={aria}
      size={small ? 'small' : 'medium'}
      selectedValue={value}
      onTabSelect={(e, d) => onChange(d.value)}
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
export function Seg({ items, value, onChange, label: aria }) {
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
export const TONE_ICON = {
  info: 'info',
  success: 'checkCircle',
  warning: 'warning',
  danger: 'errorCircle',
};
const TONE_INTENT = { info: 'info', success: 'success', warning: 'warning', danger: 'error' };
/** Fluent's MessageBar. `cls="bar"` makes it a full-width strip with square corners. */
export function MBar({ tone, children, action, cls }) {
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
export function Empty({ icon, title, text, children }) {
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
export function Menu({ btn, items, align, title, tour }) {
  const list = items.filter(Boolean);
  return (
    <div className="menu-wrap">
      <FluentMenu
        inline
        hasIcons={list.some((it) => it.icon)}
        positioning={{ position: 'below', align: align === 'left' ? 'start' : 'end', offset: 4 }}
      >
        <MenuTrigger disableButtonEnhancement>
          <Btn className={btn.cls || 'btn subtle'} title={title} aria-label={btn.label} data-tour={tour}>
            {btn.body}
          </Btn>
        </MenuTrigger>
        <MenuPopover className={cx('menu', align === 'left' ? 'left' : 'right')}>
          <MenuList>
            {list.map((it, i) =>
              it === '-' ? (
                <MenuDivider key={i} className="msep" />
              ) : it.head ? (
                <MenuGroupHeader key={i} className="mlabel">
                  {it.label}
                </MenuGroupHeader>
              ) : (
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
              ),
            )}
          </MenuList>
        </MenuPopover>
      </FluentMenu>
    </div>
  );
}
/** Moves focus into a dialog when it opens: the marked field, else the first field, else the main button. */
function FocusOnOpen() {
  const ref = useRef();
  useEffect(() => {
    const el = ref.current && ref.current.closest('.dialog');
    if (!el) return;
    const f =
      el.querySelector('[data-autofocus]') ||
      el.querySelector('.dbody input, .dbody select, .dbody textarea') ||
      el.querySelector('.dfoot .btn.primary') ||
      el;
    try {
      f.focus();
    } catch (e) {}
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
export function Dialog({ title, children, foot, onClose, wide, cls }) {
  useRestorePage();
  return (
    <FluentDialog
      open
      modalType="modal"
      onOpenChange={(e, d) => {
        if (!d.open && onClose) onClose();
      }}
    >
      <DialogSurface className={cx('dialog', wide && 'wide', cls)}>
        <DialogBody className="dlg">
          <div className="dhead">
            <DialogTitle as="h2" className="t-sub1 grow">
              {title}
            </DialogTitle>
            {onClose && (
              <Btn className="btn subtle icon" aria-label="Close" onClick={onClose}>
                <Icon n="dismiss" />
              </Btn>
            )}
          </div>
          <DialogContent className="dbody">{children}</DialogContent>
          {foot && <DialogActions className="dfoot">{foot}</DialogActions>}
        </DialogBody>
        <FocusOnOpen />
      </DialogSurface>
    </FluentDialog>
  );
}
export function Field({ label: text, hint, error, id, children, cls }) {
  return (
    <FluentField
      className={cx('field', error && 'has-err', cls)}
      label={text ? { children: text, htmlFor: id } : undefined}
      hint={!error && hint ? { className: 'field-hint', children: hint } : undefined}
      validationState={error ? 'error' : 'none'}
      validationMessage={error ? { className: 'field-err', children: error } : undefined}
    >
      {(p) =>
        isValidElement(children) && (typeof children.type === 'function' || /^(input|select|textarea)$/.test(children.type))
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
export function Json({ v, k, open }) {
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
      ref={(el) => {
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
        <Json key={x} v={v[x]} k={x} />
      ))}
    </details>
  );
}
export function CheckList({ checks }) {
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
export const STATUS_META = {
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
export function Proto({ children }) {
  return (
    <span className="proto" title="How this prototype differs from the real build">
      <Icon n="info" s="12" />
      {children}
    </span>
  );
}
