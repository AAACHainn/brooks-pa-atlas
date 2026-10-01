import { resumeInterruptedKnowledgeImports } from "@/lib/knowledge-import-jobs";
import { resumeInterruptedKnowledgeMaintenance } from "@/lib/knowledge-maintenance";

export function resumeKnowledgeBackgroundWork() {
  try {
    resumeInterruptedKnowledgeImports();
    resumeInterruptedKnowledgeMaintenance();
  } catch (error) {
    console.warn("Knowledge background jobs were not resumed during startup:", error instanceof Error ? error.message : "unknown error");
  }
}
