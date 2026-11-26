// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AreaBoundary } from '@/platform/area-boundary';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let box: HTMLDivElement;
let root: Root;
let broken = true;
function Bomb(): ReactNode {
  if (broken) throw new Error('made-up drawing error');
  return <p id="fine">all well</p>;
}
const draw = async (resetKey: string) => {
  await act(async () => {
    root.render(
      <div>
        <AreaBoundary name="This view" resetKey={resetKey}>
          <Bomb />
        </AreaBoundary>
        <p id="other">the rest of the screen</p>
      </div>,
    );
  });
};

beforeEach(() => {
  box = document.createElement('div');
  document.body.appendChild(box);
  root = createRoot(box);
  broken = true;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  act(() => root.unmount());
  box.remove();
  vi.restoreAllMocks();
});

describe('AreaBoundary', () => {
  it('shows a message bar in place of the broken part and keeps the rest of the screen', async () => {
    await draw('a');
    const bar = box.querySelector('[data-area-error="This view"]');
    expect(bar?.textContent).toContain('This view could not be shown.');
    expect(bar?.textContent).toContain('made-up drawing error');
    expect(box.querySelector('[role="alert"]')).not.toBeNull();
    expect(box.querySelector('#other')?.textContent).toBe('the rest of the screen');
  });

  it('draws again on Try again', async () => {
    await draw('a');
    broken = false;
    const button = [...box.querySelectorAll('button')].find((b) => b.textContent === 'Try again');
    await act(async () => button?.click());
    expect(box.querySelector('#fine')).not.toBeNull();
  });

  it('draws again when the reset key changes', async () => {
    await draw('a');
    broken = false;
    await draw('b');
    expect(box.querySelector('#fine')).not.toBeNull();
    expect(box.querySelector('[data-area-error]')).toBeNull();
  });
});
