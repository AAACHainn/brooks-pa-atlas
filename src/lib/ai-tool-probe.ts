import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AiToolRegistry, AiToolError, defineAiTool } from "@/lib/ai-tool-registry";
import { runAiToolTask, type AiToolTaskOptions, type AiToolRunResult } from "@/lib/ai-tool-runtime";

export type AiToolSupportProbe = {
  status: "supported" | "unsupported" | "unconfirmed" | "failed";
  run: AiToolRunResult;
};

/** Explicit, potentially billable probe. Never called by startup or existing UI flows. */
export async function probeAiToolSupport(options: Pick<AiToolTaskOptions, "config" | "skill" | "signal" | "fetchImpl" | "transport" | "traceSink"> = {}): Promise<AiToolSupportProbe> {
  const nonce = randomUUID();
  const receipt = randomUUID();
  const tool = defineAiTool({
    name: "verify_tool_support", description: "Verify function tool transport by returning a new receipt. This function has no side effects.",
    effect: "read", parameters: z.strictObject({ nonce: z.string().min(1).max(100) }),
    async execute(input) {
      if (input.nonce !== nonce) throw new AiToolError("invalid_arguments", "Use the nonce provided in the request.");
      return { receipt };
    },
    summarize: () => ({ itemCount: 1 }),
  });
  const run = await runAiToolTask({
    ...options, registry: new AiToolRegistry([tool]), allowedTools: [tool.name],
    context: { scope: { kind: "selection", imageIds: [], indexNodeIds: [] }, currentImageId: null, currentIndexNodeId: null },
    messages: [{ role: "user", content: `Call verify_tool_support with nonce ${nonce}. After receiving its result, reply with only the receipt returned by the tool.` }],
    initialToolChoice: { name: tool.name }, limits: { maxModelCalls: 3, maxToolCalls: 2, maxOutputTokens: 256 },
  });
  const status = run.status === "completed"
    ? run.successfulToolCalls > 0 && run.answer?.includes(receipt) ? "supported" : "unconfirmed"
    : run.error?.code === "unsupported-tools" ? "unsupported" : "failed";
  return { status, run };
}
