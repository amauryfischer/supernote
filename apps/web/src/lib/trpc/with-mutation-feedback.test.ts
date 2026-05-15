import { describe, expect, it, vi } from "vitest";
import { withMutationFeedback } from "./with-mutation-feedback";

function fakeToaster() {
  const calls: Array<{ title: string; description?: string; variant?: string }> = [];
  return {
    calls,
    toast: vi.fn((data: { title: string; description?: string; variant?: string }) => {
      calls.push(data);
      return "id";
    }),
  };
}

describe("withMutationFeedback", () => {
  it("appelle toast.success sur onSuccess avec libellé statique", () => {
    const t = fakeToaster();
    const opts = withMutationFeedback(t.toast, { success: "Enregistré", error: "Échec" });
    opts.onSuccess?.({}, undefined, undefined);
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]).toMatchObject({ title: "Enregistré", variant: "success" });
  });

  it("appelle toast.danger sur onError avec libellé statique", () => {
    const t = fakeToaster();
    const opts = withMutationFeedback(t.toast, { success: "OK", error: "Échec" });
    opts.onError?.(new Error("boom"), undefined, undefined);
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]).toMatchObject({ title: "Échec", variant: "danger" });
  });

  it("résout les libellés en fonction quand `error` est une factory", () => {
    const t = fakeToaster();
    const opts = withMutationFeedback(t.toast, {
      success: () => "Saved",
      error: (e) => `Fail: ${e instanceof Error ? e.message : String(e)}`,
    });
    opts.onSuccess?.({}, undefined, undefined);
    opts.onError?.(new Error("xyz"), undefined, undefined);
    expect(t.calls[0]).toMatchObject({ title: "Saved", variant: "success" });
    expect(t.calls[1]).toMatchObject({ title: "Fail: xyz", variant: "danger" });
  });

  it("ne toast pas si success/error sont undefined", () => {
    const t = fakeToaster();
    const opts = withMutationFeedback(t.toast, {});
    opts.onSuccess?.({}, undefined, undefined);
    opts.onError?.(new Error("x"), undefined, undefined);
    expect(t.calls).toHaveLength(0);
  });

  it("préserve callbacks utilisateur après toast", () => {
    const t = fakeToaster();
    const userSuccess = vi.fn();
    const userError = vi.fn();
    const opts = withMutationFeedback(
      t.toast,
      { success: "OK", error: "KO" },
      { onSuccess: userSuccess, onError: userError },
    );
    opts.onSuccess?.({ a: 1 }, undefined, undefined);
    opts.onError?.(new Error("e"), undefined, undefined);
    expect(userSuccess).toHaveBeenCalledWith({ a: 1 }, undefined, undefined);
    expect(userError).toHaveBeenCalledWith(expect.any(Error), undefined, undefined);
  });
});
