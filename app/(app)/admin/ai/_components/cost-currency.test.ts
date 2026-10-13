// The currency each admin last chose on this device: kept per user, read
// back, and never a failure where storage is missing or refuses.
import { afterEach, describe, expect, it, vi } from "vitest";
import { readRememberedCurrency, rememberCurrency } from "./cost-currency";

const ADMIN = "7c2d4e1a-0b3f-4a5c-9d8e-1f2a3b4c5d6e";

function storage(): Pick<Storage, "getItem" | "setItem"> {
  const kept = new Map<string, string>();
  return { getItem: (key) => kept.get(key) ?? null, setItem: (key, value) => void kept.set(key, value) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the remembered currency", () => {
  it("is kept per user on the device", () => {
    vi.stubGlobal("window", { localStorage: storage() });
    expect(readRememberedCurrency(ADMIN)).toBeNull();
    rememberCurrency(ADMIN, "usd");
    expect(readRememberedCurrency(ADMIN)).toBe("usd");
    expect(readRememberedCurrency("another-admin")).toBeNull();
    expect(window.localStorage.getItem(`stericare:ai-cost-currency:${ADMIN}`)).toBe("usd");
  });

  it("is none for a value it does not know, without a viewer, and where storage refuses or is missing", () => {
    const kept = storage();
    vi.stubGlobal("window", { localStorage: kept });
    kept.setItem(`stericare:ai-cost-currency:${ADMIN}`, "eur");
    expect(readRememberedCurrency(ADMIN)).toBeNull();
    rememberCurrency(null, "usd");
    expect(readRememberedCurrency(null)).toBeNull();

    const refuse = () => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    };
    vi.stubGlobal("window", { localStorage: { getItem: refuse, setItem: refuse } });
    expect(() => rememberCurrency(ADMIN, "usd")).not.toThrow();
    expect(readRememberedCurrency(ADMIN)).toBeNull();

    vi.unstubAllGlobals();
    expect(readRememberedCurrency(ADMIN)).toBeNull();
  });
});
