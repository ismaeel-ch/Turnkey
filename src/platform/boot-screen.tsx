import { WELCOME_LEAD, WELCOME_NOTE, WELCOME_STEPS, WELCOME_TITLE } from '@/shared/welcome';

/* What the page shows before the workspace has read its saved state. The server writes it into the HTML, so it paints
   with the first bytes, and the workspace keeps drawing it until it knows which screen comes first (RootInner in
   src/workspace/shell-c.tsx). A first visit sees the top of the welcome screen, in the same place and words the workspace then
   draws (Onboarding in src/workspace/shell-c.tsx); anyone else sees a plain "Loading". BootHint decides which. */

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
              <p className="muted" role="status">
                Loading
              </p>
            </div>
          </main>
        </div>
      </div>
    </>
  );
}

/* The saved state is in IndexedDB, which cannot be read before the first paint, so the workspace keeps one small
   localStorage flag beside it: set once the welcome is finished, cleared when the data is reset. Outside the
   workspace's key prefix, so the move to IndexedDB leaves it alone. */
const WELCOMED_KEY = 'turnkey:welcomed';
/** Called by the workspace whenever it knows whether the welcome is finished. */
export function noteWelcomed(done: boolean) {
  try {
    if (done) localStorage.setItem(WELCOMED_KEY, '1');
    else localStorage.removeItem(WELCOMED_KEY);
  } catch {
    // storage blocked: the boot screen then shows "Loading", which is right for everyone but a first visit
  }
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
