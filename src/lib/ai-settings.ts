import { prisma } from "@/lib/db";
import {
  AI_CONFIG_SETTING_KEY,
  type AiConfigInput,
  mergeAiConfigSecrets,
  parseStoredAiConfig,
  sanitizeAiConfig,
} from "@/lib/ai-config";

export async function readStoredAiConfig() {
  const setting = await prisma.appSetting.findUnique({
    where: { key: AI_CONFIG_SETTING_KEY },
    select: { value: true },
  });
  return parseStoredAiConfig(setting?.value);
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
  return sanitizeAiConfig(config);
}

export function resolveEndpointApiKey(
  endpointId: string,
  incomingApiKey: string | undefined,
  clearApiKey: boolean | undefined,
  storedEndpoints: Awaited<ReturnType<typeof readStoredAiConfig>>["endpoints"],
) {
  if (clearApiKey) return "";
  if (incomingApiKey?.trim()) return incomingApiKey.trim();
  return storedEndpoints.find((endpoint) => endpoint.id === endpointId)?.apiKey ?? "";
}
