export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { resumeKnowledgeBackgroundWork } = await import("@/instrumentation-node");
  resumeKnowledgeBackgroundWork();
}
