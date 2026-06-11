// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getFocusableElements,
  handleFocusTrapKeydown,
  type FocusTrapKeyEvent,
} from "./focus-trap";

function mount(html: string): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);
  return container;
}

function keyEvent(
  key: string,
  shiftKey = false,
): FocusTrapKeyEvent & { defaultPrevented: boolean } {
  const ev = {
    key,
    shiftKey,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
  return ev;
}

describe("getFocusableElements", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("collects natively focusable controls in DOM order", () => {
    const c = mount(`
      <a href="#one">one</a>
      <button>two</button>
      <input />
      <textarea></textarea>
    `);
    const els = getFocusableElements(c);
    expect(els.map((e) => e.tagName.toLowerCase())).toEqual([
      "a",
      "button",
      "input",
      "textarea",
    ]);
  });

  it("skips disabled, aria-hidden and tabindex=-1 elements", () => {
    const c = mount(`
      <button>ok</button>
      <button disabled>no-disabled</button>
      <button aria-hidden="true">no-hidden</button>
      <button tabindex="-1">no-negative</button>
    `);
    const els = getFocusableElements(c);
    expect(els).toHaveLength(1);
    expect(els[0]?.textContent).toBe("ok");
  });

  it("includes elements made tabbable via tabindex=0", () => {
    const c = mount(`<div tabindex="0">focusable div</div>`);
    expect(getFocusableElements(c)).toHaveLength(1);
  });
});

describe("handleFocusTrapKeydown", () => {
  let container: HTMLElement;
  let first: HTMLButtonElement;
  let last: HTMLButtonElement;

  beforeEach(() => {
    container = mount(`
      <button id="first">first</button>
      <input id="middle" />
      <button id="last">last</button>
    `);
    first = container.querySelector("#first") as HTMLButtonElement;
    last = container.querySelector("#last") as HTMLButtonElement;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("ignores non-Tab keys", () => {
    const ev = keyEvent("Enter");
    expect(handleFocusTrapKeydown(container, ev, first)).toBe(false);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("wraps Tab from the last element back to the first", () => {
    const focusSpy = vi.spyOn(first, "focus");
    const ev = keyEvent("Tab");
    const handled = handleFocusTrapKeydown(container, ev, last);
    expect(handled).toBe(true);
    expect(ev.defaultPrevented).toBe(true);
    expect(focusSpy).toHaveBeenCalledOnce();
  });

  it("wraps Shift+Tab from the first element back to the last", () => {
    const focusSpy = vi.spyOn(last, "focus");
    const ev = keyEvent("Tab", true);
    const handled = handleFocusTrapKeydown(container, ev, first);
    expect(handled).toBe(true);
    expect(ev.defaultPrevented).toBe(true);
    expect(focusSpy).toHaveBeenCalledOnce();
  });

  it("lets forward Tab pass through when not on the last element", () => {
    const middle = container.querySelector("#middle") as HTMLInputElement;
    const ev = keyEvent("Tab");
    const handled = handleFocusTrapKeydown(container, ev, middle);
    expect(handled).toBe(false);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("pulls focus back inside when the active element is outside the trap", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    const focusSpy = vi.spyOn(first, "focus");
    const ev = keyEvent("Tab");
    const handled = handleFocusTrapKeydown(container, ev, outside);
    expect(handled).toBe(true);
    expect(ev.defaultPrevented).toBe(true);
    expect(focusSpy).toHaveBeenCalledOnce();
  });

  it("traps Tab even when there is nothing focusable inside", () => {
    const empty = mount(`<p>no controls here</p>`);
    const ev = keyEvent("Tab");
    const handled = handleFocusTrapKeydown(empty, ev, null);
    expect(handled).toBe(true);
    expect(ev.defaultPrevented).toBe(true);
  });
});
