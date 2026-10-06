// Whose session uploads: the page's queue writes Storage objects and rows
// only while its own user is the one signed in on this browser.
import { AuthRetryableFetchError, AuthSessionMissingError } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { MediaRepository, PhotoRow } from "@/lib/photos/upload-queue";
import { ownRepository, ownToken } from "./queue-store";

const ME = "4f5a6b7c-8d9e-4f0a-9b1c-2d3e4f5a6b7c";
const SOMEONE_ELSE = "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d";

function client(answer: { session: { access_token: string; user: { id: string } } | null; error?: Error | null }) {
  const getSession = vi.fn(async () => ({ data: { session: answer.session }, error: answer.error ?? null }));
  return { auth: { getSession } } as never;
}

const signedInAs = (id: string) => client({ session: { access_token: `token-of-${id}`, user: { id } } });

function fakeRepository(): MediaRepository & { [K in keyof MediaRepository]: ReturnType<typeof vi.fn> } {
  return {
    insertPhoto: vi.fn(async () => ({ ok: true }) as const),
    updatePhoto: vi.fn(async () => ({ ok: true }) as const),
    insertFile: vi.fn(async () => ({ ok: true }) as const),
  };
}

const row = { id: "x" } as PhotoRow;

describe("ownToken", () => {
  it("is the token while the queue's own user is signed in", async () => {
    expect(await ownToken(signedInAs(ME), ME)).toBe(`token-of-${ME}`);
  });

  it("is none while someone else is signed in on this browser: their session never uploads my photos", async () => {
    expect(await ownToken(signedInAs(SOMEONE_ELSE), ME)).toBeNull();
  });

  it("is none when signed out", async () => {
    expect(await ownToken(client({ session: null }), ME)).toBeNull();
    expect(await ownToken(client({ session: null, error: new AuthSessionMissingError() }), ME)).toBeNull();
  });

  it("throws when an offline device cannot refresh its token, which counts as no connection", async () => {
    await expect(ownToken(client({ session: null, error: new AuthRetryableFetchError("Failed to fetch", 0) }), ME)).rejects.toThrow(
      "Failed to fetch",
    );
  });
});

describe("ownRepository", () => {
  it("writes rows while the queue's own user is signed in", async () => {
    const inner = fakeRepository();
    const repository = ownRepository(signedInAs(ME), ME, inner);
    expect(await repository.insertPhoto(row)).toEqual({ ok: true });
    expect(await repository.updatePhoto("x", { module_key: "visual", target: null, caption: null })).toEqual({ ok: true });
    expect(await repository.insertFile({ id: "y" } as never)).toEqual({ ok: true });
    expect(inner.insertPhoto).toHaveBeenCalledWith(row);
    expect(inner.updatePhoto).toHaveBeenCalledTimes(1);
    expect(inner.insertFile).toHaveBeenCalledTimes(1);
  });

  it("answers 'sign in again' and writes nothing under someone else's session", async () => {
    const inner = fakeRepository();
    const repository = ownRepository(signedInAs(SOMEONE_ELSE), ME, inner);
    expect(await repository.insertPhoto(row)).toMatchObject({ ok: false, reason: "unauthorized" });
    expect(await repository.insertFile({ id: "y" } as never)).toMatchObject({ ok: false, reason: "unauthorized" });
    expect(inner.insertPhoto).not.toHaveBeenCalled();
    expect(inner.insertFile).not.toHaveBeenCalled();
  });

  it("answers 'no connection' when the session cannot be checked offline, so the queue retries", async () => {
    const inner = fakeRepository();
    const offline = client({ session: null, error: new AuthRetryableFetchError("Failed to fetch", 0) });
    expect(await ownRepository(offline, ME, inner).updatePhoto("x", { module_key: null, target: null, caption: null })).toMatchObject({
      ok: false,
      reason: "network",
    });
    expect(inner.updatePhoto).not.toHaveBeenCalled();
  });
});
