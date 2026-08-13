import assert from "node:assert/strict";
import { test } from "node:test";
import { createDesktopCommandBroker } from "../lib/desktop-command-broker.mjs";

test("official MCP command is leased once and completed by the desktop host", async () => {
  const broker = createDesktopCommandBroker();
  const pending = broker.request("open-thread", { threadId: "thread-1" });
  const command = broker.take("desktop-1");
  assert.equal(command.type, "open-thread");
  assert.equal(broker.take("desktop-2"), null);
  assert.deepEqual(broker.complete(command.id, { lease: command.lease, ok: true, result: { threadId: "thread-1" } }), { accepted: true });
  assert.deepEqual(await pending, { threadId: "thread-1" });
});

test("desktop command rejects an invalid lease without losing the operation", async () => {
  const broker = createDesktopCommandBroker();
  const pending = broker.request("open-thread", {});
  const command = broker.take("desktop-1");
  assert.throws(() => broker.complete(command.id, { lease: "bad", ok: true }), (error) => error.code === "DESKTOP_COMMAND_LEASE_INVALID");
  broker.complete(command.id, { lease: command.lease, ok: false, error: { code: "OPEN_FAILED", message: "failed" } });
  await assert.rejects(pending, (error) => error.code === "OPEN_FAILED");
});

test("desktop command is only leased by its target window and is never replayed", async () => {
  let timestamp = 1_000;
  const broker = createDesktopCommandBroker({ now: () => timestamp, defaultTimeoutMs: 20_000 });
  const pending = broker.request("create-analysis", {}, { targetClientId: "desktop-owner" });
  assert.equal(broker.take("desktop-other"), null);
  const command = broker.take("desktop-owner");
  assert.equal(command.targetClientId, "desktop-owner");
  timestamp += 10_000;
  assert.equal(broker.take("desktop-owner"), null);
  assert.equal(broker.take("desktop-other"), null);
  broker.complete(command.id, { lease: command.lease, ok: true, result: { threadId: "thread-2" } });
  assert.deepEqual(await pending, { threadId: "thread-2" });
});

test("desktop broker reports only recently polling windows", () => {
  let timestamp = 1_000;
  const broker = createDesktopCommandBroker({ now: () => timestamp });
  assert.equal(broker.take("desktop-a"), null);
  assert.deepEqual(broker.activeClients(), ["desktop-a"]);
  timestamp += 5_000;
  assert.equal(broker.take("desktop-b"), null);
  assert.deepEqual(broker.activeClients(), ["desktop-a", "desktop-b"]);
  timestamp += 11_000;
  assert.deepEqual(broker.activeClients(), ["desktop-b"]);
});
