// ============================================================
// Host — bootstrap script injected into the sandbox iframe
// ============================================================

import { PROTOCOL_VERSION } from "../protocol/types.js";

/**
 * Generates the bootstrap JS code to be injected into the plugin iframe.
 * This sets up the postMessage channel on the client side.
 *
 * The returned string is safe to set as innerHTML of a <script> tag
 * inside the iframe's srcdoc.
 */
export function generateBootstrap(pluginId: string): string {
  return `
(function() {
  'use strict';

  const PROTOCOL_VERSION = '${PROTOCOL_VERSION}';
  const pluginId = '${pluginId}';
  const pending = new Map();

  function nanoid(size = 21) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let id = '';
    const arr = new Uint8Array(size);
    crypto.getRandomValues(arr);
    for (let i = 0; i < size; i++) {
      id += chars[arr[i] & 63];
    }
    return id;
  }

  function send(method, args) {
    return new Promise((resolve, reject) => {
      const id = nanoid();
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Timeout: ' + method));
      }, 10000);
      pending.set(id, { resolve, reject, timer });
      window.parent.postMessage({
        protocolVersion: PROTOCOL_VERSION,
        id,
        type: 'request',
        payload: { method, args },
        timestamp: Date.now(),
      }, '*');
    });
  }

  window.addEventListener('message', function(ev) {
    const msg = ev.data;
    if (!msg || msg.protocolVersion !== PROTOCOL_VERSION) return;
    if (msg.type === 'response' || msg.type === 'error') {
      const p = pending.get(msg.correlationId);
      if (!p) return;
      clearTimeout(p.timer);
      pending.delete(msg.correlationId);
      if (msg.type === 'response') {
        p.resolve(msg.payload.result);
      } else {
        const err = new Error(msg.payload.message);
        err.code = msg.payload.code;
        p.reject(err);
      }
    }
    if (msg.type === 'event' && window.__supernoteEventHandlers) {
      const handlers = window.__supernoteEventHandlers[msg.payload.event] || [];
      handlers.forEach(function(h) { h(msg.payload.data); });
    }
    if (msg.type === 'handshake-ack') {
      if (msg.payload.accepted) {
        window.__supernoteReady = true;
        if (window.__supernoteOnReady) window.__supernoteOnReady();
      }
    }
  });

  window.__supernoteEventHandlers = {};
  window.__supernoteReady = false;

  window.supernote = {
    entities: {
      list: function(args) { return send('entities.list', args); },
      get: function(id) { return send('entities.get', { id }); },
      create: function(data) { return send('entities.create', data); },
      update: function(id, data) { return send('entities.update', { id, data }); },
      delete: function(id) { return send('entities.delete', { id }); },
    },
    schemas: {
      list: function() { return send('schemas.list', {}); },
      get: function(id) { return send('schemas.get', { id }); },
    },
    search: {
      query: function(q) { return send('search.query', { q }); },
    },
    storage: {
      get: function(key) { return send('storage.get', { key }); },
      set: function(key, value) { return send('storage.set', { key, value }); },
    },
    ui: {
      registerBlock: function(def) { return send('ui.registerBlock', def); },
      registerSlashItem: function(item) { return send('ui.registerSlashItem', item); },
      registerCommand: function(cmd) { return send('ui.registerCommand', cmd); },
      showNotification: function(opts) { return send('ui.showNotification', opts); },
      addSidebarPanel: function(panel) { return send('ui.addSidebarPanel', panel); },
    },
    hooks: {
      on: function(event, handler) {
        if (!window.__supernoteEventHandlers[event]) {
          window.__supernoteEventHandlers[event] = [];
        }
        window.__supernoteEventHandlers[event].push(handler);
        send('hooks.on', { event });
      },
    },
    fetch: function(url, opts) { return send('network.fetch', { url, opts }); },
  };

  // Initiate handshake
  window.parent.postMessage({
    protocolVersion: PROTOCOL_VERSION,
    id: nanoid(),
    type: 'handshake',
    payload: {
      pluginId: pluginId,
      protocolVersion: PROTOCOL_VERSION,
      permissions: [],
    },
    timestamp: Date.now(),
  }, '*');
})();
`;
}

/**
 * Generates the full srcdoc HTML for the plugin iframe sandbox.
 */
export function generateSrcdoc(pluginId: string, pluginCode: string): string {
  const bootstrap = generateBootstrap(pluginId);
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
<script>
${bootstrap}
</script>
<script>
${pluginCode}
</script>
</body>
</html>`;
}
