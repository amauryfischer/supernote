// ============================================================
// Test helper — in-process MessageChannel mock (no iframe needed)
// ============================================================

import type { MessagePort as SDKMessagePort } from "../../host/types.js";

/**
 * Creates a pair of connected mock ports using Node's MessageChannel.
 * Messages posted to port1 are received by port2 and vice versa.
 */
export function createMockChannel(): {
  hostPort: SDKMessagePort;
  pluginPort: SDKMessagePort;
} {
  const { port1, port2 } = new MessageChannel();

  port1.start();
  port2.start();

  const wrap = (port: MessagePort): SDKMessagePort => ({
    postMessage: (data) => port.postMessage(data),
    set onmessage(handler: ((ev: { data: unknown }) => void) | null) {
      port.onmessage = handler ? (ev) => handler({ data: ev.data }) : null;
    },
    get onmessage() {
      return null;
    },
  });

  return {
    hostPort: wrap(port1),
    pluginPort: wrap(port2),
  };
}

/**
 * Creates a pair of connected mock ports backed by plain arrays.
 * Useful for synchronous test scenarios without Node MessageChannel.
 */
export function createSyncMockChannel(): {
  hostPort: SDKMessagePort;
  pluginPort: SDKMessagePort;
  flushHostToPlugin: () => void;
  flushPluginToHost: () => void;
} {
  const h2p: unknown[] = [];
  const p2h: unknown[] = [];

  let hostHandler: ((ev: { data: unknown }) => void) | null = null;
  let pluginHandler: ((ev: { data: unknown }) => void) | null = null;

  const hostPort: SDKMessagePort = {
    postMessage: (data) => {
      h2p.push(data);
    },
    set onmessage(h: ((ev: { data: unknown }) => void) | null) {
      hostHandler = h;
    },
    get onmessage() {
      return hostHandler;
    },
  };

  const pluginPort: SDKMessagePort = {
    postMessage: (data) => {
      p2h.push(data);
    },
    set onmessage(h: ((ev: { data: unknown }) => void) | null) {
      pluginHandler = h;
    },
    get onmessage() {
      return pluginHandler;
    },
  };

  return {
    hostPort,
    pluginPort,
    flushHostToPlugin: () => {
      const msgs = h2p.splice(0);
      for (const m of msgs) {
        pluginHandler?.({ data: m });
      }
    },
    flushPluginToHost: () => {
      const msgs = p2h.splice(0);
      for (const m of msgs) {
        hostHandler?.({ data: m });
      }
    },
  };
}
