/**
 * Minimal browser shim for `node:events`.
 *
 * The auto-shim in `node-builtins.ts` returns Proxy no-ops, which breaks
 * `class Engine extends EventEmitter` at runtime. This file ships a real
 * (tiny) EventEmitter so packages like `@supernote/automations` work
 * unchanged inside the vault Web Worker.
 *
 * Implements the surface the engine actually uses: on/off/emit/once/
 * removeAllListeners. Not 100% Node-spec compatible (no domain, no
 * captureRejections), but matches the common path.
 */

type Listener = (...args: unknown[]) => void;

export class EventEmitter<EventMap extends Record<string, unknown[]> = Record<string, unknown[]>> {
  #listeners: Map<string, Set<Listener>> = new Map();

  on<E extends keyof EventMap & string>(event: E, listener: (...args: EventMap[E]) => void): this {
    let set = this.#listeners.get(event);
    if (!set) {
      set = new Set();
      this.#listeners.set(event, set);
    }
    set.add(listener as Listener);
    return this;
  }

  off<E extends keyof EventMap & string>(event: E, listener: (...args: EventMap[E]) => void): this {
    this.#listeners.get(event)?.delete(listener as Listener);
    return this;
  }

  once<E extends keyof EventMap & string>(event: E, listener: (...args: EventMap[E]) => void): this {
    const wrapped = ((...args: unknown[]) => {
      this.off(event, wrapped as never);
      (listener as Listener)(...args);
    }) as Listener;
    return this.on(event, wrapped as never);
  }

  emit<E extends keyof EventMap & string>(event: E, ...args: EventMap[E]): boolean {
    const set = this.#listeners.get(event);
    if (!set || set.size === 0) return false;
    for (const l of [...set]) {
      try {
        l(...args);
      } catch (err) {
        console.error(`[EventEmitter] listener for "${event}" threw`, err);
      }
    }
    return true;
  }

  removeAllListeners<E extends keyof EventMap & string>(event?: E): this {
    if (event) this.#listeners.delete(event);
    else this.#listeners.clear();
    return this;
  }

  listenerCount<E extends keyof EventMap & string>(event: E): number {
    return this.#listeners.get(event)?.size ?? 0;
  }
}

export default EventEmitter;
