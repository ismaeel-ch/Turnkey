import { createContext, useContext, useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { PresenceGroup, motionTokens } from '@fluentui/react-components';
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

/** A stack of short messages: each rises into place, and fades down and out when its time is up. */
export function ToastMotion({ children }: { children: ReactElement[] }) {
  return (
    <PresenceGroup>
      {children.map((c) => (
        <Slide
          key={c.key}
          outY="8px"
          duration={motionTokens.durationNormal}
          easing={IN}
          exitDuration={motionTokens.durationFast}
          exitEasing={OUT}
        >
          {c}
        </Slide>
      ))}
    </PresenceGroup>
  );
}

/* ---------- dialogs ----------
   A dialog is on screen while the store holds one. Fluent's Dialog animates its own way in and out when its `open`
   changes, so the host keeps the dialog it was last given, tells it that it is closing, and lets go of it once
   Fluent's exit has run. */
const Closing = createContext(false);
/** False once the dialog around this has been closed and is on its way out. */
export const useDialogOpen = () => !useContext(Closing);
// Fluent's dialog surface leaves in durationGentle; a little over that, and the closed dialog is dropped
const DIALOG_OUT = motionTokens.durationGentle + 50;

export function DialogMotion({ children }: { children?: ReactElement | null }) {
  const [last, setLast] = useState<ReactElement | null>(children || null);
  if (children && children !== last) setLast(children);
  useEffect(() => {
    if (children || !last) return;
    const t = setTimeout(() => setLast(null), DIALOG_OUT);
    return () => clearTimeout(t);
  }, [children, last]);
  const el: ReactNode = children || last;
  if (!el) return null;
  return <Closing.Provider value={!children}>{el}</Closing.Provider>;
}
