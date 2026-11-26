/**
 * LangGraph's browser entry (`@langchain/langgraph/web`) does not set up async context, and `interrupt()` needs it
 * to find the running graph. Node has `AsyncLocalStorage`; browsers do not. This stand-in keeps the current value on a
 * stack for the synchronous part of a call. `interrupt()` is only ever called at the top of a node, before any
 * `await`, so that is enough. Nodes in this package follow that rule; do not call `interrupt()` after an `await`.
 */
import { AsyncLocalStorageProviderSingleton } from '@langchain/core/singletons';

class StackContext {
  private stack: unknown[] = [];
  getStore(): unknown {
    return this.stack[this.stack.length - 1];
  }
  run<T>(store: unknown, callback: () => T): T {
    this.stack.push(store);
    try {
      return callback();
    } finally {
      this.stack.pop();
    }
  }
  enterWith(store: unknown): void {
    this.stack.push(store);
  }
}

let done = false;
/** Safe to call more than once. Does nothing where the platform already set up its own context (Node). */
export function installBrowserContext(): void {
  if (done) return;
  done = true;
  AsyncLocalStorageProviderSingleton.initializeGlobalInstance(new StackContext());
}
