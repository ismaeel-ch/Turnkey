import {
  WELCOME_LEAD,
  WELCOME_NOTE,
  WELCOME_QUICK_NOTE,
  WELCOME_STATIONS,
  WELCOME_STEPS,
  WELCOME_TICKS,
  WELCOME_TITLE,
} from '@/shared/welcome';
import { AGENTS } from '@/workspace/agents';
import glyphs from './pwa/glyphs.json';
import { type BootIntent, WELCOMED_KEY } from './boot-intent';

/* What the page shows before the workspace has drawn its first screen. Server only: the pages draw it into the HTML,
   and it stays until RootInner in src/workspace/shell-c.tsx knows which screen comes first (see bootScreenDone). */

/** Same picture as Logo in src/workspace/ui.tsx, which this file cannot import without pulling in the workspace. */
function Logo() {
  return (
    <svg className="logo" width={28} height={28} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="2" width="13" height="5" rx="1.5" fill="var(--ag-purple)" />
      <rect x="17" y="2" width="5" height="13" rx="1.5" fill="var(--ag-teal)" />
      <rect x="9" y="17" width="13" height="5" rx="1.5" fill="var(--ag-pumpkin)" />
      <rect x="2" y="9" width="5" height="13" rx="1.5" fill="var(--ag-pink)" />
      <rect x="9" y="9" width="6" height="6" rx="1.5" fill="var(--colorNeutralForeground1)" />
    </svg>
  );
}

/** Same drawing as Icon in src/workspace/ui.tsx. Only the server draws this screen, so the glyphs stay out of the page's script. */
function Icon({ n, s }: { n: string; s: string }) {
  const g = glyphs as Record<string, string>;
  return (
    <svg
      className={'ic s' + s}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: g[n] || g.circle }}
    />
  );
}

/** Same look as Btn in src/workspace/ui.tsx (Fluent's button) without its script. `data-boot` names what it asks for. */
function BootBtn({ intent, primary, children }: { intent: BootIntent; primary?: boolean; children: string }) {
  return (
    <button type="button" className={primary ? 'boot-btn primary' : 'boot-btn'} data-boot={intent}>
      {children}
    </button>
  );
}

/**
 * The server draws this into the page, so it paints with the first bytes and costs no script. A first visit sees
 * the whole first step of the welcome, the same words and layout as Onboarding in src/workspace/shell-c.tsx, with
 * buttons that work: WorkspaceLoader notes the one pressed and loads the workspace, which then does what was asked.
 * Anyone else sees a plain "Loading". BootHint decides which. Hidden once the workspace draws its first screen.
 */
export function BootScreen() {
  return (
    <>
      <div id="boot">
        <strong>Turnkey</strong>
        <span>Loading</span>
      </div>
      <div className="ob" id="boot-welcome">
        <div className="boot-card">
          <aside className="ob-rail">
            <div className="row">
              <Logo />
              <strong className="t-sub1">Turnkey</strong>
            </div>
            <ol className="ob-steps">
              {WELCOME_STEPS.map((s, i) => (
                <li key={s} className={i === 0 ? 'cur' : undefined} aria-current={i === 0 ? 'step' : undefined}>
                  <span className="ob-n">{i + 1}</span>
                  {s}
                </li>
              ))}
            </ol>
            <p className="t-cap muted">{WELCOME_NOTE}</p>
          </aside>
          <main className="ob-main">
            <div className="ob-body">
              <h1 className="t-title1">{WELCOME_TITLE}</h1>
              <p className="lead">
                Turnkey
                {WELCOME_LEAD}
              </p>
              <div className="ob-quick row">
                <BootBtn intent="sample" primary>
                  Try a sample
                </BootBtn>
                <BootBtn intent="own">Describe your own</BootBtn>
                <span className="boot-wait muted t-cap" role="status" />
              </div>
              <p className="t-cap muted ob-quick-note">{WELCOME_QUICK_NOTE}</p>
              <div className="ob-line" aria-hidden="true">
                {WELCOME_STATIONS.map((s, i) => {
                  const a = AGENTS[s.agent];
                  return (
                    <span key={s.id} className="ob-pair">
                      <span className="ob-st">
                        <span className={'av sq av-sm acc-' + (a ? a.acc : 'steel')}>
                          <Icon n={a ? a.icon : 'person'} s="16" />
                        </span>
                        {s.name}
                      </span>
                      {i < WELCOME_STATIONS.length - 1 && <Icon n="arrowRight" s="16" />}
                    </span>
                  );
                })}
              </div>
              <ul className="plain ticks">
                {WELCOME_TICKS.map((t) => (
                  <li key={t.icon}>
                    <Icon n={t.icon} s="16" />
                    <span>
                      <strong>{t.lead}</strong>
                      {t.text}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="ob-foot">
              <span className="grow" />
              <BootBtn intent="start">Get started</BootBtn>
            </div>
          </main>
        </div>
      </div>
    </>
  );
}

/* Runs before the boot screen is parsed. A returning visitor (see WELCOMED_KEY)
   and any address that opens a shared or installed app skip the welcome, so they get "Loading" instead of a welcome
   screen that would vanish. Kept tiny and inline on purpose: it must run before the first paint. The card is .boot-card, not .ob-card, so
   anything waiting for the real welcome screen does not mistake this one for it. */
const HINT = `try{if(localStorage.getItem(${JSON.stringify(WELCOMED_KEY)})||location.hash.length>1||location.pathname.length>1)document.documentElement.classList.add('tk-seen')}catch(e){document.documentElement.classList.add('tk-seen')}`;

/** For the server pages only: the inline script that picks which boot screen shows. Put it before the WorkspaceLoader. */
export function BootHint() {
  return <script dangerouslySetInnerHTML={{ __html: HINT }} />;
}
