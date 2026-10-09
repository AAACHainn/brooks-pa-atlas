import { prisma } from "@/lib/db";
import { cancelAllRobotRuns } from "@/lib/ai-robot-runs";
import {
  AI_CONFIG_SETTING_KEY,
  LEGACY_AI_CONFIG_SETTING_KEY,
  LEGACY_AI_CONFIG_V2_SETTING_KEY,
  LEGACY_AI_CONFIG_V3_SETTING_KEY,
  LEGACY_AI_CONFIG_V4_SETTING_KEY,
  type AiConfigInput,
  mergeAiConfigSecrets,
  parseStoredAiConfig,
  sanitizeAiConfig,
} from "@/lib/ai-config";

export async function readStoredAiConfig(client: Pick<typeof prisma, "appSetting"> = prisma) {
  const settings = await client.appSetting.findMany({
    where: { key: { in: [AI_CONFIG_SETTING_KEY, LEGACY_AI_CONFIG_V4_SETTING_KEY, LEGACY_AI_CONFIG_V3_SETTING_KEY, LEGACY_AI_CONFIG_V2_SETTING_KEY, LEGACY_AI_CONFIG_SETTING_KEY] } },
    select: { key: true, value: true },
  });
  const current = settings.find((setting) => setting.key === AI_CONFIG_SETTING_KEY);
  const legacyV4 = settings.find((setting) => setting.key === LEGACY_AI_CONFIG_V4_SETTING_KEY);
  const legacyV3 = settings.find((setting) => setting.key === LEGACY_AI_CONFIG_V3_SETTING_KEY);
  const legacyV2 = settings.find((setting) => setting.key === LEGACY_AI_CONFIG_V2_SETTING_KEY);
  const legacy = settings.find((setting) => setting.key === LEGACY_AI_CONFIG_SETTING_KEY);
  return parseStoredAiConfig(current?.value ?? legacyV4?.value ?? legacyV3?.value ?? legacyV2?.value ?? legacy?.value);
}

export async function readAiConfigDto() {
  return sanitizeAiConfig(await readStoredAiConfig());
}

export async function saveAiConfig(input: AiConfigInput) {
  const current = await readStoredAiConfig();
  const config = mergeAiConfigSecrets(input, current);
  await prisma.appSetting.upsert({
    where: { key: AI_CONFIG_SETTING_KEY },
    create: { key: AI_CONFIG_SETTING_KEY, value: JSON.stringify(config) },
    update: { value: JSON.stringify(config) },
  });
  if (!config.skills.globalRobot.enabled) {
    cancelAllRobotRuns();
    await (await import("@/lib/ai-robot-task-service")).pauseAllRobotTasks();
  }
  return sanitizeAiConfig(config);
}

export function resolveEndpointApiKey(
  endpointId: string,
  incomingApiKey: string | undefined,
  clearApiKey: boolean | undefined,
  storedEndpoints: Array<{ id: string; apiKey: string }>,
) {
  if (clearApiKey) return "";
  if (incomingApiKey?.trim()) return incomingApiKey.trim();
  return storedEndpoints.find((endpoint) => endpoint.id === endpointId)?.apiKey ?? "";
}
