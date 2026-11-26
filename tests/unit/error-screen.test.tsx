// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorScreen } from '@/platform/error-screen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let box: HTMLDivElement;
let broken = true;
function Bomb(): ReactNode {
  if (broken) throw new Error('made-up drawing error');
  return createElement('p', { id: 'fine' }, 'all well');
}
const show = async () => {
  await act(async () => {
    createRoot(box).render(createElement(ErrorScreen, null, createElement(Bomb)));
  });
};

beforeEach(() => {
  box = document.createElement('div');
  document.body.appendChild(box);
  broken = true;
  vi.spyOn(console, 'error').mockImplementation(() => {}); // React and the screen both log the error
});
afterEach(() => {
  box.remove();
  vi.restoreAllMocks();
});

describe('ErrorScreen', () => {
  it('shows its children while nothing is wrong', async () => {
    broken = false;
    await show();
    expect(box.querySelector('#fine')?.textContent).toBe('all well');
    expect(box.querySelector('[role=alert]')).toBeNull();
  });

  it('says what happened, that the data is safe, and shows the message', async () => {
    await show();
    const alert = box.querySelector('[role=alert]');
    expect(alert?.textContent).toContain('This screen could not be drawn');
    expect(alert?.textContent).toContain('saved in this browser');
    expect(alert?.textContent).toContain('made-up drawing error');
  });

  it('draws the children again after "Try again" once the problem is gone', async () => {
    await show();
    broken = false;
    const retry = [...box.querySelectorAll('button')].find((b) => b.textContent === 'Try again')!;
    await act(async () => retry.click());
    expect(box.querySelector('#fine')).not.toBeNull();
  });

  it('offers to reload the page', async () => {
    await show();
    expect([...box.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Try again', 'Reload the page']);
  });
});
