import "fake-indexeddb/auto";
import { beforeEach, afterAll, expect, test, vi } from "vitest";
import type { SessionRecord } from "../contracts/models";
import { ApiError } from "../lib/api-client";
import { cacheSession, queueSession, flushQueue, listPending, readCachedSession, resolveConflict, clearOwnerCache, offlineDb } from "../lib/offline";

vi.mock("../lib/api-client", () => ({
  ApiError: class extends Error { constructor(public status: number, message: string, public details?: unknown) { super(message); } },
  saveSession: vi.fn(), getSession: vi.fn(),
}));
import { saveSession, getSession } from "../lib/api-client";
const owner = "owner-a";
const make = (): SessionRecord => ({
  id: crypto.randomUUID(), revision: 1, workoutId: null, routineId: null, weekId: null,
  performedOn: "2026-10-20", title: "Workout", status: "active", blocks: [], results: [],
  notes: "", source: null, startedAt: null, finishedAt: null,
});
beforeEach(async () => { vi.resetAllMocks(); await offlineDb.pending.clear(); await offlineDb.sessions.clear(); });
afterAll(() => offlineDb.close());
test("partitioned cache never exposes another owner's session", async () => {
  const session = make();
  await cacheSession(owner, session);
  expect(await readCachedSession("owner-b", session.id)).toBeUndefined();
});
test("idempotency receipt survives uncertain network failures", async () => {
  const session = make();
  await queueSession(owner, session);
  vi.mocked(saveSession).mockRejectedValueOnce(new TypeError("Network failed")).mockResolvedValueOnce({ ...session, revision: 2 });
  await flushQueue(owner);
  expect((await listPending(owner))[0].status).toBe("error");
  await flushQueue(owner);
  expect(vi.mocked(saveSession).mock.calls[0][1]).toBe(vi.mocked(saveSession).mock.calls[1][1]);
  expect(await listPending(owner)).toHaveLength(0);
});
test("edits during an in-flight save are preserved and rebased", async () => {
  const session = make();
  await queueSession(owner, session);
  vi.mocked(saveSession).mockImplementationOnce(async () => {
    await queueSession(owner, { ...session, notes: "newer edit" });
    return { ...session, revision: 2 };
  });
  await flushQueue(owner);
  const pending = (await listPending(owner))[0];
  expect(pending.session.notes).toBe("newer edit");
  expect(pending.session.revision).toBe(2);
  expect(pending.request).toBeUndefined();
  vi.mocked(saveSession).mockResolvedValueOnce({ ...pending.session, revision: 3 });
  await flushQueue(owner);
  expect(await listPending(owner)).toHaveLength(0);
});
test("conflicts require explicit resolution and block cache clearing", async () => {
  const session = make();
  await queueSession(owner, { ...session, notes: "local" });
  vi.mocked(saveSession).mockRejectedValueOnce(new ApiError(409, "Changed", { current: { ...session, revision: 2, notes: "server" } }));
  expect((await flushQueue(owner)).conflicts).toBe(1);
  await expect(clearOwnerCache(owner)).rejects.toThrow("Sync");
  vi.mocked(getSession).mockResolvedValueOnce({ ...session, revision: 3, notes: "latest server" });
  await resolveConflict(owner, session.id, "local");
  const pending = (await listPending(owner))[0];
  expect(pending.session.revision).toBe(3);
  expect(pending.session.notes).toBe("local");
  expect(pending.request).toBeUndefined();
});
test("authentication expiry preserves pending data", async () => {
  await queueSession(owner, make());
  vi.mocked(saveSession).mockRejectedValueOnce(new ApiError(401, "Sign in"));
  expect((await flushQueue(owner)).authRequired).toBe(true);
  expect(await listPending(owner)).toHaveLength(1);
});
