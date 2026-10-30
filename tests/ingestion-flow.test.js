import { describe, expect, test } from "bun:test";
import { countIngestionItems, ingestionStep } from "../src/lib/ingestion.ts";

const item = (status, includeEmpty = false) => ({ status, includeEmpty });
const run = (items, overrides = {}) => ({ scanComplete: true, status: "ready", items, ...overrides });

describe("ingestion setup navigation", () => {
  test("a scan with no tables cannot use a saved later step", () => {
    expect(ingestionStep(run([]), 3)).toBe(0);
  });
  test("unreadable tables stay at results", () => {
    expect(ingestionStep(run([item("error")]), 2)).toBe(1);
  });
  test("empty tables require a selection before leaving results", () => {
    expect(ingestionStep(run([item("empty")]), 3)).toBe(1);
    expect(countIngestionItems([item("empty")])).toBe(0);
    expect(ingestionStep(run([item("empty", true)]), 2)).toBe(2);
  });
  test("populated tables need no empty-table selection and first show results", () => {
    const populated = run([item("data"), item("empty")]);
    expect(countIngestionItems(populated.items)).toBe(1);
    expect(ingestionStep(populated)).toBe(1);
    expect(ingestionStep(populated, 2)).toBe(2);
  });
  test("incomplete scans stay at scan regardless of saved navigation", () => {
    expect(ingestionStep(run([item("pending")], { scanComplete: false }), 3)).toBe(0);
  });
  test("ingestion progress, completed runs and retries keep their destination", () => {
    for (const status of ["ingesting", "saving", "completed", "partial", "failed", "interrupted"]) {
      expect(ingestionStep(run([item("done")], { status }))).toBe(3);
    }
  });
});

test("clearing populated tables blocks continuing until one is selected again", () => {
  const cleared = run([{ ...item("data"), excluded: true }, item("empty")]);
  expect(countIngestionItems(cleared.items)).toBe(0);
  expect(ingestionStep(cleared, 3)).toBe(1);
  cleared.items[0].excluded = false;
  expect(countIngestionItems(cleared.items)).toBe(1);
  expect(ingestionStep(cleared, 2)).toBe(2);
});

test("excluded tables are omitted even when their previous empty selection is set", () => {
  expect(countIngestionItems([{ ...item("empty", true), excluded: true }, item("data")])).toBe(1);
});

test("partial, cancelled and export-failed runs allow chat with completed tables", async () => {
  const { canChatWithRun } = await import("../src/lib/ingestion.ts");
  for (const status of ["partial", "cancelled", "failed", "completed"]) {
    expect(canChatWithRun(run([item("done"), item("failed")], { status }))).toBe(true);
  }
  expect(canChatWithRun(run([item("failed")], { status: "failed" }))).toBe(false);
  expect(canChatWithRun(run([item("done")], { status: "ingesting" }))).toBe(false);
  expect(canChatWithRun(run([{ ...item("done"), excluded: true }]))).toBe(false);
});

test("progress counts selected tables only and keeps failures in remaining", async () => {
  const { ingestionCounts } = await import("../src/lib/ingestion.ts");
  const items = [item("done"), item("done"), item("failed"), item("failed"), item("failed"),
    { ...item("data"), excluded: true }, item("empty"), item("error")];
  expect(ingestionCounts(items)).toEqual({ total: 5, ready: 2, remaining: 3, failed: 3 });
  items[2].status = "processing";
  expect(ingestionCounts(items).remaining).toBe(3);
  items[2].status = "done";
  expect(ingestionCounts(items)).toEqual({ total: 5, ready: 3, remaining: 2, failed: 2 });
});
