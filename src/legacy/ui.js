/* ===== Turnkey prototype · small Fluent-style building blocks ===== */
function Icon({ n, s, cls }) { return html`<svg class=${cx('ic', s && 's' + s, cls)} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: ICONS[n] || ICONS.circle }}></svg>`; }
function Logo({ size }) {
  const z = size || 22;
  return html`<svg class="logo" width=${z} height=${z} viewBox="0 0 24 24" aria-hidden="true">
    <rect x="2" y="2" width="13" height="5" rx="1.5" fill="var(--ag-purple)" /><rect x="17" y="2" width="5" height="13" rx="1.5" fill="var(--ag-teal)" />
    <rect x="9" y="17" width="13" height="5" rx="1.5" fill="var(--ag-pumpkin)" /><rect x="2" y="9" width="5" height="13" rx="1.5" fill="var(--ag-pink)" />
    <rect x="9" y="9" width="6" height="6" rx="1.5" fill="var(--colorNeutralForeground1)" /></svg>`;
}
function Avatar({ name, size, acc }) { return html`<span class=${cx('av', size && 'av-' + size, 'acc-' + (acc || accFor(name)))} aria-hidden="true">${initials(name)}</span>`; }
function AgentAv({ id, size }) { const a = AGENTS[id]; if (!a) return html`<${Avatar} name="You" size=${size} acc="steel" />`; return html`<span class=${cx('av sq', size && 'av-' + size, 'acc-' + a.acc)} title=${a.name + ' agent'}><${Icon} n=${a.icon} s=${size === 'xs' ? '12' : size === 'lg' ? '24' : '16'} /></span>`; }
function Spinner() { return html`<span class="spin" role="status" aria-label="Working"></span>`; }
function Switch({ on, onChange, text, id, disabled, title }) {
  return html`<label class=${cx('switch', disabled && 'is-off')} title=${title}><input type="checkbox" id=${id} checked=${!!on} disabled=${disabled} onChange=${(e) => onChange(e.target.checked)} /><span class="track"><span class="thumb"></span></span>${text && html`<span class="switch-t">${text}</span>`}</label>`;
}
function Tabs({ items, value, onChange, cls, label: aria }) {
  return html`<div class=${cx('tabs', cls)} role="tablist" aria-label=${aria}>${items.map((it) => html`<button key=${it.id} role="tab" aria-selected=${it.id === value} class=${cx('tab', it.id === value && 'on')} data-tour=${it.tour} title=${it.title} onClick=${() => onChange(it.id)}>${it.icon && html`<${Icon} n=${it.icon} />`}<span>${it.label}</span>${it.count != null && html`<span class="tab-n">${it.count}</span>`}</button>`)}</div>`;
}
function Seg({ items, value, onChange, label: aria }) {
  return html`<div class="seg" role="group" aria-label=${aria}>${items.map((it) => html`<button key=${it.id} class=${cx(it.id === value && 'on')} aria-pressed=${it.id === value} title=${it.title} onClick=${() => onChange(it.id)}>${it.icon && html`<${Icon} n=${it.icon} s="16" />`}${it.label}</button>`)}</div>`;
}
const TONE_ICON = { info: 'info', success: 'checkCircle', warning: 'warning', danger: 'errorCircle' };
function MBar({ tone, children, action, cls }) { const t = tone || 'info'; return html`<div class=${cx('mbar', 'm-' + t, cls)} role=${t === 'danger' || t === 'warning' ? 'alert' : 'status'}><${Icon} n=${TONE_ICON[t]} /><div class="grow">${children}</div>${action}</div>`; }
function Empty({ icon, title, text, children }) { return html`<div class="empty"><span class="empty-ic"><${Icon} n=${icon || 'info'} s="24" /></span><strong>${title}</strong>${text && html`<p class="muted">${text}</p>`}${children}</div>`; }
function Menu({ btn, items, align, title, tour }) {
  const [open, setOpen] = useState(false), ref = useRef();
  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }, k = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [open]);
  return html`<div class="menu-wrap" ref=${ref}>
    <button class=${btn.cls || 'btn subtle'} title=${title} aria-label=${btn.label} data-tour=${tour} aria-haspopup="menu" aria-expanded=${open} onClick=${() => setOpen(!open)}>${btn.body}</button>
    ${open && html`<div class=${cx('menu', align === 'left' ? 'left' : 'right')} role="menu">${items.filter(Boolean).map((it, i) => it === '-' ? html`<div key=${i} class="msep"></div>` : it.head ? html`<div key=${i} class="mlabel">${it.label}</div>` : html`<button key=${i} class=${cx('mi', it.danger && 'danger')} role="menuitem" disabled=${it.disabled} onClick=${() => { setOpen(false); if (it.on) it.on(); }}>${it.icon && html`<${Icon} n=${it.icon} />`}<span class="grow">${it.label}</span>${it.hint && html`<span class="muted t-cap">${it.hint}</span>`}${it.check && html`<${Icon} n="check" s="16" />`}</button>`)}</div>`}
  </div>`;
}
function Dialog({ title, children, foot, onClose, wide, cls }) {
  const ref = useRef();
  useEffect(() => { const el = ref.current; if (!el) return; const f = el.querySelector('[data-autofocus]') || el.querySelector('.dbody input, .dbody select, .dbody textarea') || el.querySelector('.dfoot .btn.primary') || el; try { f.focus(); } catch (e) {} }, []);
  return html`<div class="overlay" onMouseDown=${(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}>
    <div class=${cx('dialog', wide && 'wide', cls)} role="dialog" aria-modal="true" aria-label=${title} ref=${ref} tabindex="-1" onKeyDown=${(e) => { if (e.key === 'Escape' && onClose) { e.stopPropagation(); onClose(); } }}>
      <div class="dhead"><h2 class="t-sub1 grow">${title}</h2>${onClose && html`<button class="btn subtle icon" aria-label="Close" onClick=${onClose}><${Icon} n="dismiss" /></button>`}</div>
      <div class="dbody">${children}</div>
      ${foot && html`<div class="dfoot">${foot}</div>`}
    </div></div>`;
}
function Field({ label: text, hint, error, id, children, cls }) { return html`<div class=${cx('field', error && 'has-err', cls)}><label for=${id}>${text}</label>${children}${error ? html`<span class="field-err"><${Icon} n="errorCircle" s="12" />${error}</span>` : hint ? html`<span class="field-hint">${hint}</span>` : null}</div>`; }
function Json({ v, k, open }) {
  if (v === null || typeof v !== 'object') return html`<div class="jrow">${k != null && html`<span class="jk">${k}: </span>`}<span class=${'jv j-' + (v === null ? 'null' : typeof v)}>${typeof v === 'string' ? '"' + (v.length > 180 ? v.slice(0, 180) + '…' : v) + '"' : String(v)}</span></div>`;
  const keys = Object.keys(v);
  return html`<details class="jnode" ref=${(el) => { if (el && open && !el.__init) { el.__init = 1; el.open = true; } }}><summary>${k != null && html`<span class="jk">${k} </span>`}<span class="muted">${Array.isArray(v) ? '[' + keys.length + ']' : '{' + keys.length + '}'}</span></summary>${keys.slice(0, 80).map((x) => html`<${Json} key=${x} v=${v[x]} k=${x} />`)}</details>`;
}
function CheckList({ checks }) {
  if (!checks || !checks.length) return html`<p class="muted">No checks have run yet.</p>`;
  return html`<ul class="checks">${checks.map((c, i) => html`<li key=${i} class=${c.ok ? 'ok' : 'bad'}><${Icon} n=${c.ok ? 'checkCircle' : 'errorCircle'} /><div><div class="t-strong">${c.label}</div>${c.detail && html`<div class="muted t-cap">${c.detail}</div>`}</div></li>`)}</ul>`;
}
const STATUS_META = {
  idle: { text: 'Waiting', tone: 'neutral' }, working: { text: 'Working', tone: 'info' }, checking: { text: 'Checking', tone: 'info' }, ok: { text: 'Checked', tone: 'success' },
  sentback: { text: 'Sent back', tone: 'warning' }, waiting: { text: 'Needs you', tone: 'warning' }, failed: { text: 'Failed', tone: 'danger' }
};
function Proto({ children }) { return html`<span class="proto" title="How this prototype differs from the real build"><${Icon} n="info" s="12" />${children}</span>`; }
