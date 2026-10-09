import "server-only";
import { z } from "zod";
import type { AiFunctionDefinition } from "@/lib/ai-model-types";

export type AiToolScope =
  | { kind: "library" }
  | { kind: "selection"; imageIds: readonly string[]; indexNodeIds: readonly string[] };
export type AiToolExecutionContext = {
  runId: string;
  signal: AbortSignal;
  scope: AiToolScope;
  currentImageId: string | null;
  currentIndexNodeId: string | null;
};
export type AiToolSummary = { resourceIds?: string[]; itemCount?: number };
/** Trusted server output: image bytes travel as model attachments, never tool JSON. */
export type AiToolModelImage = { resourceId: string; dataUrl: string };
export type AiToolModelResult = { data: unknown; images?: readonly AiToolModelImage[] };
export type AiToolDefinition = {
  name: string;
  effect: "read" | "write";
  modelDefinition: AiFunctionDefinition;
  validate: (input: unknown) => unknown;
  execute: (input: unknown, context: AiToolExecutionContext) => Promise<unknown>;
  toModelResult?: (input: unknown, output: unknown) => AiToolModelResult;
  summarize: (input: unknown, output: unknown) => AiToolSummary;
};

export class AiToolError extends Error {
  constructor(readonly code: "forbidden_resource" | "not_found" | "invalid_arguments" | "source_changed" | "result_too_large", message: string) {
    super(message);
    this.name = "AiToolError";
  }
}

/** One schema owns both the public parameter contract and runtime validation. */
export function defineAiTool<T, R>(options: {
  name: string;
  description: string;
  effect: "read" | "write";
  parameters: z.ZodType<T>;
  execute: (input: T, context: AiToolExecutionContext) => Promise<R>;
  toModelResult?: (input: T, output: R) => AiToolModelResult;
  summarize: (input: T, output: R) => AiToolSummary;
}): AiToolDefinition {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(options.name) || !options.description.trim()) throw new Error("Invalid tool definition.");
  const parameters = z.toJSONSchema(options.parameters, { io: "input", target: "draft-7" });
  delete parameters.$schema;
  if (parameters.type !== "object" || parameters.additionalProperties !== false) {
    throw new Error("Tool parameters must use a strict object schema.");
  }
  return Object.freeze({
    name: options.name,
    effect: options.effect,
    modelDefinition: { name: options.name, description: options.description, parameters },
    validate(input: unknown) {
      const parsed = options.parameters.safeParse(input);
      if (!parsed.success) throw new AiToolError("invalid_arguments", "Arguments do not match the tool schema.");
      return parsed.data;
    },
    execute: (input: unknown, context: AiToolExecutionContext) => options.execute(input as T, context),
    ...(options.toModelResult ? { toModelResult: (input: unknown, output: unknown) => options.toModelResult!(input as T, output as R) } : {}),
    summarize: (input: unknown, output: unknown) => options.summarize(input as T, output as R),
  });
}

export class AiToolRegistry {
  private readonly definitions = new Map<string, AiToolDefinition>();
  constructor(tools: readonly AiToolDefinition[]) {
    for (const tool of tools) {
      if (this.definitions.has(tool.name)) throw new Error(`Duplicate tool: ${tool.name}`);
      this.definitions.set(tool.name, tool);
    }
  }
  get(name: string) { return this.definitions.get(name); }
  select(names: readonly string[]) {
    return [...new Set(names)].map((name) => {
      const tool = this.get(name);
      if (!tool) throw new Error(`Unknown allowed tool: ${name}`);
      if (tool.effect !== "read") throw new Error("Write tools are not enabled in this infrastructure version.");
      return tool;
    });
  }
}
