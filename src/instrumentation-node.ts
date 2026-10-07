import { resumeInterruptedKnowledgeImports } from "@/lib/knowledge-import-jobs";
import { resumeInterruptedKnowledgeMaintenance } from "@/lib/knowledge-maintenance";
import { recoverRobotTasks } from "@/lib/ai-robot-task-service";

export function resumeKnowledgeBackgroundWork() {
  void recoverRobotTasks().catch(() => { console.warn("Robot tasks could not be recovered; check database migrations."); });
  try {
    resumeInterruptedKnowledgeImports();
    resumeInterruptedKnowledgeMaintenance();
  } catch (error) {
    console.warn("Knowledge background jobs were not resumed during startup:", error instanceof Error ? error.message : "unknown error");
  }
}
