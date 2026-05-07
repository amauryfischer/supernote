import type { VaultEvent, EventKind } from "../types.js";

export type Subscriber = (event: VaultEvent) => void;

export interface EventBus {
  publish(event: VaultEvent): void;
  subscribe(subscriber: Subscriber): () => void;
  subscriberCount(): number;
}

export function createEventBus(): EventBus {
  const subscribers = new Set<Subscriber>();

  function publish(event: VaultEvent): void {
    for (const sub of subscribers) {
      try {
        sub(event);
      } catch {
        // subscriber errors must not crash the bus
      }
    }
  }

  function subscribe(subscriber: Subscriber): () => void {
    subscribers.add(subscriber);
    return () => { subscribers.delete(subscriber); };
  }

  function subscriberCount(): number {
    return subscribers.size;
  }

  return { publish, subscribe, subscriberCount };
}

export function buildEvent(kind: EventKind, entityId?: string, payload?: unknown): VaultEvent {
  return {
    kind,
    entityId,
    payload: payload ?? null,
    timestamp: new Date().toISOString(),
  };
}
