import { describe, it, expect, vi } from "vitest";
import { createEventBus, buildEvent } from "../http/event-bus.js";

describe("EventBus", () => {
  it("publishes events to all subscribers", () => {
    const bus = createEventBus();
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    bus.subscribe(fn1);
    bus.subscribe(fn2);

    const event = buildEvent("entity.created", "id-1", { foo: "bar" });
    bus.publish(event);

    expect(fn1).toHaveBeenCalledWith(event);
    expect(fn2).toHaveBeenCalledWith(event);
  });

  it("unsubscribing stops receiving events", () => {
    const bus = createEventBus();
    const fn = vi.fn();
    const unsubscribe = bus.subscribe(fn);
    unsubscribe();

    bus.publish(buildEvent("entity.deleted", "id-1"));
    expect(fn).not.toHaveBeenCalled();
  });

  it("does not crash if a subscriber throws", () => {
    const bus = createEventBus();
    bus.subscribe(() => { throw new Error("subscriber error"); });
    expect(() => bus.publish(buildEvent("entity.updated", "id-1"))).not.toThrow();
  });

  it("subscriberCount reflects current subscribers", () => {
    const bus = createEventBus();
    expect(bus.subscriberCount()).toBe(0);
    const unsub1 = bus.subscribe(vi.fn());
    const unsub2 = bus.subscribe(vi.fn());
    expect(bus.subscriberCount()).toBe(2);
    unsub1();
    expect(bus.subscriberCount()).toBe(1);
    unsub2();
    expect(bus.subscriberCount()).toBe(0);
  });

  it("buildEvent sets timestamp and kind", () => {
    const event = buildEvent("relation.created", "src-1", { some: "data" });
    expect(event.kind).toBe("relation.created");
    expect(event.entityId).toBe("src-1");
    expect(typeof event.timestamp).toBe("string");
    expect(new Date(event.timestamp).getTime()).toBeGreaterThan(0);
  });
});
