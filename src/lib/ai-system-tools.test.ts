import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { before, after, test } from "node:test";
import Database from "better-sqlite3";
import type { PrismaClient } from "@/generated/prisma/client";
import { AI_CONFIG_SETTING_KEY } from "@/lib/ai-config";
import { runAiToolTask } from "@/lib/ai-tool-runtime";
import type { AiToolRegistry, AiToolExecutionContext } from "@/lib/ai-tool-registry";
import { AiToolError } from "@/lib/ai-tool-registry";
import { toolTestConfig, turnResponse } from "@/lib/ai-tool-test-helpers";

let prisma: PrismaClient;
let registry: AiToolRegistry;
let directory: string;
const previousDatabaseUrl = process.env.DATABASE_URL;
const config = toolTestConfig();
const context: AiToolExecutionContext = { runId: "test", signal: new AbortController().signal,
  scope: { kind: "library" }, currentImageId: "current", currentIndexNodeId: "node" };

before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "atlas-ai-system-tools-"));
  process.env.DATABASE_URL = `file:${path.join(directory, "main.db")}`;
  const main = new Database(path.join(directory, "main.db"));
  const migrationRoot = path.join(process.cwd(), "prisma/migrations");
  for (const entry of (await readdir(migrationRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    main.exec(await readFile(path.join(migrationRoot, entry.name, "migration.sql"), "utf8"));
  }
  main.close();
  prisma = (await import("@/lib/db")).prisma;
  registry = (await import("@/lib/ai-system-tools")).createSystemToolRegistry();
  await prisma.appSetting.create({ data: { key: AI_CONFIG_SETTING_KEY, value: JSON.stringify(config) } });
  await prisma.indexNode.createMany({ data: [
    { id: "root", name: "Flash Cards", path: "Flash Cards" },
    { id: "node", name: "Charts", parentId: "root", depth: 1, path: "Flash Cards / Charts" },
    { id: "previous-node", name: "Stops", path: "Stops" },
    { id: "percent", name: "100%", path: "100%" },
    ...Array.from({ length: 24 }, (_, index) => ({ id: `page-${index}`, name: `Page ${index}`, parentId: "root", depth: 1, path: `Pages / ${String(index).padStart(2, "0")}` })),
  ] });
  await prisma.chartImage.createMany({ data: [
    { id: "current", originalName: "current.png", libraryPath: "images/current.png", hash: "a".repeat(64), mimeType: "image/png", sizeBytes: 10,
      indexNodeId: "node", title: "Charts: Price vs. Time", notes: "saved notes", ocrText: "INITIAL_TEXT" },
    { id: "previous", originalName: "previous.png", libraryPath: "images/previous.png", hash: "b".repeat(64), mimeType: "image/png", sizeBytes: 10,
      indexNodeId: "previous-node", title: "Protective Stops", ocrText: "OLD_TEXT" },
  ] });
});

after(async () => {
  await prisma?.$disconnect();
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
  // Explicitly remove only this fixture's database file, never a directory.
  await unlink(path.join(directory, "main.db"));
});

test("configured model invokes real index and latest image reads without changing saved data", async () => {
  await prisma.chartImage.update({ where: { id: "current" }, data: { ocrText: "CURRENT_TEXT" } });
  const before = await prisma.appSetting.findUniqueOrThrow({ where: { key: AI_CONFIG_SETTING_KEY } });
  let requests = 0;
  const result = await runAiToolTask({ registry, allowedTools: ["list_index_nodes", "get_image_context"],
    context: { scope: { kind: "selection", imageIds: ["current"], indexNodeIds: ["node"] }, currentImageId: "current", currentIndexNodeId: "node" },
    messages: [{ role: "user", content: "Read the current image and identify its index." }], fetchImpl: async (url, init) => {
      assert.equal(String(url), "https://example.test/v1/chat/completions");
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer private-test-key");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, "mock-model");
      if (++requests === 1) return turnResponse(null, [{ id: "indexes", name: "list_index_nodes", arguments: '{"query":"Charts"}' }]);
      if (requests === 2) {
        const nodes = JSON.parse(body.messages.at(-1).content).data.nodes;
        assert.deepEqual(nodes.map((node: { id: string }) => node.id), ["node"]);
        return turnResponse(null, [{ id: "image", name: "get_image_context", arguments: '{"imageId":"current"}' }]);
      }
      const image = JSON.parse(body.messages.at(-1).content).data;
      assert.equal(image.imageId, "current");
      assert.equal(image.snapshot.ocr.text, "CURRENT_TEXT");
      assert.equal(image.snapshot.index.path, "Flash Cards / Charts");
      assert.equal(image.snapshot.notes, "saved notes");
      assert.doesNotMatch(JSON.stringify(image), /libraryPath|images\/current|base64|OLD_TEXT/);
      return turnResponse("依据当前图片 CURRENT_TEXT 回答。");
    },
  });
  assert.equal(result.status, "completed");
  assert.equal(result.successfulToolCalls, 2);
  assert.equal(result.modelCalls, 3);
  assert.match(result.answer!, /CURRENT_TEXT/);
  assert.equal(result.records.find((record) => record.toolName === "get_image_context" && record.type === "tool_completed")?.resourceIds?.[0], "current");
  assert.doesNotMatch(JSON.stringify(result.records), /CURRENT_TEXT|saved notes|private-test-key/);
  assert.equal((await prisma.appSetting.findUniqueOrThrow({ where: { key: AI_CONFIG_SETTING_KEY } })).value, before.value);
  assert.equal(await prisma.aiReadingMessage.count(), 0);
});

test("system read tools enforce exact image/index authorization without scope expansion", async () => {
  const scoped = { ...context, scope: { kind: "selection" as const, imageIds: ["current"], indexNodeIds: ["node"] } };
  const image = registry.get("get_image_context")!;
  await assert.rejects(image.execute(image.validate({ imageId: "previous" }), scoped), /authorized scope/);
  const nodes = registry.get("list_index_nodes")!;
  await assert.rejects(nodes.execute(nodes.validate({ parentId: "root" }), scoped), /authorized scope/);
  const output = await nodes.execute(nodes.validate({}), scoped) as { nodes: Array<{ id: string }> };
  assert.deepEqual(output.nodes.map((node) => node.id), ["node"]);
  let errorCode: string | undefined;
  const missing = await runAiToolTask({ registry, allowedTools: ["get_image_context"], config,
    context: { scope: scoped.scope, currentImageId: scoped.currentImageId, currentIndexNodeId: scoped.currentIndexNodeId },
    messages: [{ role: "user", content: "read" }], limits: { maxModelCalls: 2 },
    fetchImpl: async (_url, init) => {
      const last = JSON.parse(String(init?.body)).messages.at(-1);
      if (last.role === "tool") { errorCode = JSON.parse(last.content).error.code; return turnResponse("Permission denied"); }
      return turnResponse(null, [{ id: "forbidden", name: "get_image_context", arguments: '{"imageId":"previous"}' }]);
    },
  });
  assert.equal(missing.status, "completed");
  assert.equal(missing.successfulToolCalls, 0);
  assert.equal(errorCode, "forbidden_resource");
});

test("index reads paginate within bounded pages and match percent signs literally", async () => {
  const tool = registry.get("list_index_nodes")!;
  const first = await tool.execute(tool.validate({ query: "Pages", parentId: "root" }), context) as { nodes: Array<{ id: string }>; nextOffset: number; total: number };
  assert.equal(first.nodes.length, 20);
  assert.equal(first.total, 24);
  assert.equal(first.nextOffset, 20);
  const second = await tool.execute(tool.validate({ query: "Pages", parentId: "root", offset: first.nextOffset }), context) as { nodes: Array<{ id: string }>; nextOffset: number | null };
  assert.equal(second.nodes.length, 4); assert.equal(second.nextOffset, null);
  assert.equal(new Set([...first.nodes, ...second.nodes].map((node) => node.id)).size, 24);
  const percent = await tool.execute(tool.validate({ query: "%" }), context) as { nodes: Array<{ id: string }> };
  assert.deepEqual(percent.nodes.map((node) => node.id), ["percent"]);
  const injection = await tool.execute(tool.validate({ query: "%' OR 1=1 --" }), context) as { nodes: unknown[] };
  assert.deepEqual(injection.nodes, []);
  assert.throws(() => tool.validate({ limit: 51 }), /schema/);
});

test("server-only boundary rejects default client imports", () => {
  assert.throws(() => execFileSync(process.execPath, ["--input-type=module", "-e", "import 'server-only'"], {
    cwd: process.cwd(), stdio: "pipe", timeout: 5_000,
  }), /Command failed/);
});

test("robot image reads select fields and page Unicode text without losing source content", async () => {
  const text = "汉😀".repeat(3_000);
  await prisma.chartImage.create({ data: { id: "long-image", originalName: "long.png", libraryPath: "images/long.png", hash: "c".repeat(64), mimeType: "image/png", sizeBytes: 10, ocrText: text, notes: "notes should be omitted" } });
  const paged = (await import("@/lib/ai-system-tools")).createSystemToolRegistry({ pagedImageContext: true }).get("get_image_context")!;
  const read = async (offset: number) => paged.execute(paged.validate({ imageId: "long-image", fields: ["ocr"], offset, limit: 4_000 }), context) as Promise<{ snapshot: { ocr: { text: string }; notes?: string }; pages: { ocr: { total: number; returned: number; nextOffset: number | null } } }>;
  const first = await read(0);
  assert.equal(first.pages.ocr.total, 6_000); assert.equal(first.pages.ocr.nextOffset, 4_000);
  assert.equal(first.snapshot.notes, undefined);
  const second = await read(first.pages.ocr.nextOffset!);
  assert.equal(second.pages.ocr.returned, 2_000); assert.equal(second.pages.ocr.nextOffset, null);
  assert.equal(first.snapshot.ocr.text + second.snapshot.ocr.text, text);
  assert.equal((await prisma.chartImage.findUniqueOrThrow({ where: { id: "long-image" } })).ocrText, text);
  assert.doesNotMatch(JSON.stringify(first), /libraryPath|base64|notes should be omitted/);
  assert.throws(() => paged.validate({ imageId: "long-image", fields: ["secret"] }), AiToolError);
});
