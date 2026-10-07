import type { FormEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { submitAction } from "./submit";

function submitEvent() {
  const form = {} as HTMLFormElement;
  const preventDefault = vi.fn();
  return { event: { preventDefault, currentTarget: form } as unknown as FormEvent<HTMLFormElement>, form, preventDefault };
}

describe("submitAction", () => {
  it("stops the browser's own submit and hands the form's data to the action", () => {
    const action = vi.fn();
    const data = new FormData();
    data.set("role", "admin");
    const read = vi.fn(() => data);
    const { event, form, preventDefault } = submitEvent();

    submitAction(action, false, read)(event);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledWith(form);
    expect(action).toHaveBeenCalledWith(data);
  });

  it("sends nothing while the last submit is still running", () => {
    const action = vi.fn();
    const read = vi.fn(() => new FormData());
    const { event, preventDefault } = submitEvent();

    submitAction(action, true, read)(event);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(read).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
  });
});
