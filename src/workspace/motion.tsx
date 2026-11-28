import { createContext, useContext, useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { motionTokens } from '@fluentui/react-components';
import { Fade, Slide } from '@fluentui/react-motion-components-preview';

/* ===== Motion for things that come and go, with Fluent's motion components =====
   Fluent 2: what arrives decelerates and takes its time; what leaves accelerates and is gone sooner. The
   components below turn themselves off when the device asks for reduced motion. Motion that needs no exit (lists,
   cards, view changes) is in src/styles/motion.css. */
const IN = motionTokens.curveDecelerateMid,
  OUT = motionTokens.curveAccelerateMid;

/**
 * What a motion wrapper was last given, kept while it leaves. The wrappers below take one element, or nothing when
 * the element should go: it then plays its exit and is removed. The element must put a `ref` on its root DOM node.
 */
function useLast(el: ReactElement | null | false | undefined) {
  const [last, setLast] = useState<ReactElement | null>(el || null);
  // keeping the previous props in state is React's own pattern for "remember the last value that was not empty"
  if (el && el !== last) setLast(el);
  return el || last;
}

/** A panel at the end edge (the record panel of a built app): slides in from that edge and back out to it. */
export function PanelMotion({ children }: { children?: ReactElement | null | false }) {
  const el = useLast(children);
  if (!el) return null;
  return (
    <Slide
      visible={!!children}
      appear
      unmountOnExit
      outX="24px"
      duration={motionTokens.durationGentle}
      easing={IN}
      exitDuration={motionTokens.durationFast}
      exitEasing={OUT}
    >
      {el}
    </Slide>
  );
}

/** A layer over the page (the backdrop of a built app's form): fades in and out. */
export function LayerMotion({ children }: { children?: ReactElement | null | false }) {
  const el = useLast(children);
  if (!el) return null;
  return (
    <Fade visible={!!children} appear unmountOnExit duration={motionTokens.durationNormal} exitDuration={motionTokens.durationFaster}>
      {el}
    </Fade>
  );
}

/* ---------- dialogs ----------
   A dialog is on screen while the store holds one. Fluent's Dialog animates its own way in and out when its `open`
   changes, so the host keeps the dialog it was last given, tells it that it is closing, and lets go of it once
   Fluent's exit has run. */
const Closing = createContext(false);
/** False once the dialog around this has been closed and is on its way out. */
export const useDialogOpen = () => !useContext(Closing);
/** How a dialog leaves: sooner than it came, accelerating (Fluent's own default takes as long out as in). */
export const DIALOG_EXIT = { exitDuration: motionTokens.durationFast, exitEasing: OUT };
// a little over the exit, and the closed dialog is dropped
const DIALOG_OUT = motionTokens.durationFast + 50;

export function DialogMotion({ children }: { children?: ReactElement | null }) {
  // `nth` counts openings: a dialog opened while the last one is still leaving starts afresh, with its own state
  const [held, setHeld] = useState<{ el: ReactElement | null; open: boolean; nth: number }>({
    el: children || null,
    open: !!children,
    nth: 0,
  });
  if (children ? children !== held.el || !held.open : held.open)
    setHeld({ el: children || held.el, open: !!children, nth: held.nth + (children && !held.open ? 1 : 0) });
  useEffect(() => {
    if (held.open || !held.el) return;
    const t = setTimeout(() => setHeld((h) => (h.open ? h : { ...h, el: null })), DIALOG_OUT);
    return () => clearTimeout(t);
  }, [held.open, held.el]);
  const el: ReactNode = children || held.el;
  if (!el) return null;
  return (
    <Closing.Provider key={held.nth} value={!children}>
      {el}
    </Closing.Provider>
  );
}
