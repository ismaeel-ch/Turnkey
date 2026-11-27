import { Suspense, lazy, type ComponentType, type JSX, type ReactElement } from 'react';

/**
 * A component that loads its module the first time it is drawn, so its code stays out of the first page load.
 * It draws nothing until the module arrives. `name` is the component's export in that module.
 */
export function later<M, K extends keyof M>(load: () => Promise<M>, name: K) {
  type P = M[K] extends ComponentType<infer Q> ? Q : never;
  const Lazy = lazy(() => load().then((m) => ({ default: m[name] as ComponentType<P> })));
  const Later = (props: P): ReactElement => (
    <Suspense fallback={null}>
      {/* the props type is generic here, so JSX cannot check it against Lazy's own; the caller's call is checked */}
      <Lazy {...(props as P & JSX.IntrinsicAttributes)} />
    </Suspense>
  );
  Later.displayName = String(name);
  return Later;
}
