"use client";

import { Check, Eye, EyeOff, Loader2, Plus, RefreshCw, Settings, Sparkles, Trash2, X, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useAppDialog } from "@/app/app-dialog";
import { createBrowserId } from "@/lib/browser-id";
import {
  AI_CONFIG_VERSION, type AiConfigDto, type AiEndpointDto, type AiProvider,
  DEFAULT_OCR_REFINEMENT_PROMPT, DEFAULT_READING_COMPANION_PROMPT, DEFAULT_SUBTITLE_KNOWLEDGE_PROMPT,
  type EmbeddingEndpointDto, OCR_REFINEMENT_SKILL_KEY, READING_COMPANION_SKILL_KEY,
  SUBTITLE_KNOWLEDGE_SKILL_KEY, resolveAiEndpointUrls, resolveEmbeddingEndpointUrls,
} from "@/lib/ai-config";

type Locale = "zh" | "en";
type SettingsTab = "endpoints" | "embeddings" | "skills";
type ChatDraft = AiEndpointDto & { apiKey: string; clearApiKey: boolean };
type EmbeddingDraft = EmbeddingEndpointDto & { apiKey: string; clearApiKey: boolean };
type ConfigDraft = Omit<AiConfigDto, "endpoints" | "embeddingEndpoints"> & {
  endpoints: ChatDraft[]; embeddingEndpoints: EmbeddingDraft[];
};
type EndpointDraft = ChatDraft | EmbeddingDraft;
type EndpointPatch = Partial<ChatDraft & EmbeddingDraft>;

const labels = {
  zh: {
    title: "设置", subtitle: "配置应用功能与外部服务", ai: "AI 配置",
    endpoints: "大模型", embeddings: "Embedding", skills: "技能",
    addChatEndpoint: "新增大模型端点", addEmbeddingEndpoint: "新增 Embedding 端点",
    chatEmpty: "还没有大模型端点，请先新增一个。", embeddingEmpty: "还没有 Embedding 端点，请单独配置供应商和模型。",
    active: "启用", name: "名称", provider: "服务商", openai: "OpenAI", deepseek: "DeepSeek", custom: "自定义",
    baseUrl: "API Base URL", chatBaseHint: "系统会在 Base URL 后追加 /chat/completions 和 /models。",
    embeddingBaseHint: "系统会在 Base URL 后追加 /embeddings 和 /models。",
    customUrls: "分别填写完整请求地址", chatUrl: "Chat Completions URL", modelsUrl: "Models URL（可选）",
    embeddingsUrl: "Embeddings URL", finalChatUrl: "最终对话地址", finalEmbeddingsUrl: "最终向量地址", finalModelsUrl: "最终模型地址",
    model: "默认模型", embeddingModel: "Embedding 模型", apiKey: "API Key（可选）",
    keyStored: "已保存密钥；留空将保持不变。", keyNotStored: "未保存密钥；本地服务可以留空。",
    clearKey: "清除已保存密钥", undoClearKey: "取消清除", fetchModels: "拉取模型", testing: "测试中",
    test: "测试连接", testEmbedding: "测试 Embedding", testSuccess: "连接成功",
    testChatSuccess: "大模型端点已成功返回 Chat Completions 响应。", testEmbeddingSuccess: "Embedding 端点已返回有效向量。",
    noModel: "请选择模型", addModelPlaceholder: "输入模型 ID", add: "添加", noModels: "暂无模型，可拉取或手动添加。",
    skillTitle: "AI 精校 OCR", skillDescription: "结合原图校对当前 OCR 草稿。模型返回结果后只更新未保存草稿。",
    readingSkillTitle: "AI 阅读伴侣", readingSkillDescription: "结合当前图片及全部学习资料进行翻译、讲解、比较和讨论。",
    subtitleSkillTitle: "字幕知识整理", subtitleSkillDescription: "AI 深度整理只判断分段、主题和关键词，不再重写字幕正文。建议选择便宜的非推理模型。",
    subtitlePrivacy: "只有选择“AI 深度整理”时才调用大模型；快速导入只调用 Embedding。PPT 图片不会发送给 Embedding 服务。",
    prompt: "提示词", modelOverride: "模型覆盖", inheritModel: "继承启用的大模型端点",
    retryModel: "失败重试模型（可选）", retryModelHint: "建议选择更便宜的非推理模型；留空则继续使用首次模型。",
    disableReasoning: "字幕导入固定关闭 thinking / reasoning", maxOutputTokens: "单窗口输出 Token 配置上限",
    maxOutputTokensHint: "实际请求还会取“输入 Token × 2”和 3000 的更小值；触顶或超限会直接失败。",
    privacy: "精校时会把当前图片和 OCR 文本发送到启用的大模型端点。",
    readingPrivacy: "伴读时会把近期会话、参考图片及其学习资料发送到启用的大模型端点。",
    cancel: "取消", save: "保存设置", saving: "保存中", loadFailed: "无法加载 AI 设置。", saveFailed: "无法保存 AI 设置。",
    operationFailed: "操作失败", invalidUrl: "请检查端点地址。", deleteTitle: "删除端点？",
    deleteMessage: "删除后，该端点的本地配置和密钥将一并移除。", delete: "删除", confirm: "确认", close: "关闭",
  },
  en: {
    title: "Settings", subtitle: "Configure app features and external services", ai: "AI configuration",
    endpoints: "Language models", embeddings: "Embedding", skills: "Skills",
    addChatEndpoint: "Add language-model endpoint", addEmbeddingEndpoint: "Add embedding endpoint",
    chatEmpty: "No language-model endpoints yet.", embeddingEmpty: "No embedding endpoints yet. Configure its provider and model separately.",
    active: "Active", name: "Name", provider: "Provider", openai: "OpenAI", deepseek: "DeepSeek", custom: "Custom",
    baseUrl: "API Base URL", chatBaseHint: "The app appends /chat/completions and /models.",
    embeddingBaseHint: "The app appends /embeddings and /models.", customUrls: "Use full request URLs",
    chatUrl: "Chat Completions URL", modelsUrl: "Models URL (optional)", embeddingsUrl: "Embeddings URL",
    finalChatUrl: "Final chat URL", finalEmbeddingsUrl: "Final embeddings URL", finalModelsUrl: "Final models URL",
    model: "Default model", embeddingModel: "Embedding model", apiKey: "API Key (optional)",
    keyStored: "A key is stored. Leave blank to keep it.", keyNotStored: "No key is stored. Local services can leave this blank.",
    clearKey: "Clear saved key", undoClearKey: "Keep saved key", fetchModels: "Fetch models", testing: "Testing",
    test: "Test connection", testEmbedding: "Test embedding", testSuccess: "Connection succeeded",
    testChatSuccess: "The language-model endpoint returned a Chat Completions response.",
    testEmbeddingSuccess: "The embedding endpoint returned a valid vector.", noModel: "Select a model",
    addModelPlaceholder: "Enter model ID", add: "Add", noModels: "No models yet. Fetch or add one manually.",
    skillTitle: "AI OCR refinement", skillDescription: "Proofread the OCR draft against the image.",
    readingSkillTitle: "AI reading companion", readingSkillDescription: "Explain and discuss the current image with its study context.",
    subtitleSkillTitle: "Subtitle knowledge processing", subtitleSkillDescription: "AI deep processing only chooses ranges, topics, and keywords; it no longer rewrites subtitle text. Prefer a low-cost non-reasoning model.",
    subtitlePrivacy: "The language model is called only in AI deep mode. Quick import calls only the Embedding endpoint.",
    prompt: "Prompt", modelOverride: "Model override", inheritModel: "Inherit active language-model endpoint",
    retryModel: "Retry model (optional)", retryModelHint: "Prefer a cheaper non-reasoning model. Empty uses the primary model again.",
    disableReasoning: "Thinking / reasoning is always disabled for subtitle imports", maxOutputTokens: "Configured output-token limit per window",
    maxOutputTokensHint: "The request also uses the lower of input tokens × 2 and 3000. Truncation or overrun fails immediately.",
    privacy: "Refinement sends the image and OCR text to the active language-model endpoint.",
    readingPrivacy: "Reading companion sends recent conversation, reference images, and study context to the active language-model endpoint.",
    cancel: "Cancel", save: "Save settings", saving: "Saving", loadFailed: "Could not load AI settings.",
    saveFailed: "Could not save AI settings.", operationFailed: "Operation failed", invalidUrl: "Check the endpoint URLs.",
    deleteTitle: "Delete endpoint?", deleteMessage: "Its local configuration and saved API key will be removed.",
    delete: "Delete", confirm: "Confirm", close: "Close",
  },
} as const;
type Labels = (typeof labels)[Locale];

function providerDefaults(provider: AiProvider) {
  if (provider === "openai") return { name: "OpenAI", baseUrl: "https://api.openai.com/v1" };
  if (provider === "deepseek") return { name: "DeepSeek", baseUrl: "https://api.deepseek.com" };
  return { name: "Custom", baseUrl: "" };
}
function createChatEndpoint(): ChatDraft {
  return { id: createBrowserId(), name: "OpenAI", provider: "openai", baseUrl: "https://api.openai.com/v1",
    useCustomUrls: false, chatCompletionsUrl: "", modelsUrl: "", models: [], defaultModel: "",
    hasApiKey: false, apiKey: "", clearApiKey: false };
}
function createEmbeddingEndpoint(): EmbeddingDraft {
  return { id: createBrowserId(), name: "OpenAI Embeddings", provider: "openai", baseUrl: "https://api.openai.com/v1",
    useCustomUrls: false, embeddingsUrl: "", modelsUrl: "", models: [], embeddingModel: "",
    hasApiKey: false, apiKey: "", clearApiKey: false };
}
function toDraft(config: AiConfigDto): ConfigDraft {
  return { ...config,
    endpoints: config.endpoints.map((endpoint) => ({ ...endpoint, apiKey: "", clearApiKey: false })),
    embeddingEndpoints: config.embeddingEndpoints.map((endpoint) => ({ ...endpoint, apiKey: "", clearApiKey: false })) };
}
function requestValue(endpoint: EndpointDraft) {
  const common = { id: endpoint.id, name: endpoint.name, provider: endpoint.provider, baseUrl: endpoint.baseUrl,
    useCustomUrls: endpoint.useCustomUrls, modelsUrl: endpoint.modelsUrl, models: endpoint.models,
    apiKey: endpoint.apiKey, clearApiKey: endpoint.clearApiKey };
  return "embeddingModel" in endpoint
    ? { ...common, embeddingsUrl: endpoint.embeddingsUrl, embeddingModel: endpoint.embeddingModel }
    : { ...common, chatCompletionsUrl: endpoint.chatCompletionsUrl, defaultModel: endpoint.defaultModel };
}

function EndpointCard({ mode, endpoint, active, t, busy, testing, manualModel, keyVisible, onActivate, onPatch,
  onDelete, onFetch, onTest, onManualModel, onAddModel, onToggleKey }: {
  mode: "chat" | "embedding"; endpoint: EndpointDraft; active: boolean; t: Labels; busy: boolean; testing: boolean;
  manualModel: string; keyVisible: boolean; onActivate: () => void; onPatch: (patch: EndpointPatch) => void;
  onDelete: () => void; onFetch: () => void; onTest: () => void; onManualModel: (value: string) => void;
  onAddModel: () => void; onToggleKey: () => void;
}) {
  const embeddingEndpoint = mode === "embedding" && "embeddingModel" in endpoint ? endpoint : null;
  const chatEndpoint = mode === "chat" && "defaultModel" in endpoint ? endpoint : null;
  if (!embeddingEndpoint && !chatEndpoint) return null;
  const embedding = Boolean(embeddingEndpoint);
  let urls: { primary: string; models: string } | null = null;
  try {
    urls = embeddingEndpoint
      ? (() => { const value = resolveEmbeddingEndpointUrls(embeddingEndpoint); return { primary: value.embeddingsUrl, models: value.modelsUrl }; })()
      : (() => { const value = resolveAiEndpointUrls(chatEndpoint!); return { primary: value.chatCompletionsUrl, models: value.modelsUrl }; })();
  } catch { urls = null; }
  const selectedModel = embeddingEndpoint ? embeddingEndpoint.embeddingModel : chatEndpoint!.defaultModel;
  return <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
    <div className="flex items-center gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-3">
      <label className="inline-flex items-center gap-2 text-sm font-semibold"><input type="radio" checked={active} onChange={onActivate} name={`active-${mode}-endpoint`} className="h-4 w-4 text-cyan-700" />{endpoint.name || t.active}</label>
      {active ? <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-[10px] font-semibold text-cyan-800">{t.active}</span> : null}
      <button type="button" onClick={onDelete} className="ml-auto grid h-8 w-8 place-items-center rounded text-rose-600 hover:bg-rose-50" aria-label={t.delete}><Trash2 className="h-4 w-4" /></button>
    </div>
    <div className="space-y-4 p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-xs font-medium text-zinc-600">{t.name}<input value={endpoint.name} onChange={(e) => onPatch({ name: e.target.value })} className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100" /></label>
        <label className="text-xs font-medium text-zinc-600">{t.provider}<select value={endpoint.provider} onChange={(e) => { const provider = e.target.value as AiProvider; onPatch({ provider, ...providerDefaults(provider) }); }} className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100"><option value="openai">{t.openai}</option><option value="deepseek">{t.deepseek}</option><option value="custom">{t.custom}</option></select></label>
      </div>
      <label className="block text-xs font-medium text-zinc-600">{t.apiKey}<div className="relative mt-1"><input type={keyVisible ? "text" : "password"} value={endpoint.apiKey} onChange={(e) => onPatch({ apiKey: e.target.value, clearApiKey: false })} placeholder={endpoint.hasApiKey ? "••••••••••••" : "sk-..."} className="h-10 w-full rounded-md border border-zinc-200 bg-white px-3 pr-10 text-sm outline-none transition focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100" /><button type="button" onClick={onToggleKey} className="absolute right-1 top-1 grid h-8 w-8 place-items-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900">{keyVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div><span className="mt-1 flex justify-between text-[11px] font-normal text-zinc-500"><span>{endpoint.hasApiKey ? t.keyStored : t.keyNotStored}</span>{endpoint.hasApiKey ? <button type="button" onClick={() => onPatch({ clearApiKey: !endpoint.clearApiKey, apiKey: "" })} className={endpoint.clearApiKey ? "font-medium text-cyan-700 hover:text-cyan-900" : "font-medium text-rose-600 hover:text-rose-800"}>{endpoint.clearApiKey ? t.undoClearKey : t.clearKey}</button> : null}</span></label>
      <label className="block text-xs font-medium text-zinc-600">{t.baseUrl}<input value={endpoint.baseUrl} disabled={endpoint.useCustomUrls} onChange={(e) => onPatch({ baseUrl: e.target.value })} className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500" /><span className="mt-1 block text-[11px] font-normal text-zinc-500">{embedding ? t.embeddingBaseHint : t.chatBaseHint}</span></label>
      <label className="flex items-center gap-2 text-xs font-medium text-zinc-700"><input type="checkbox" checked={endpoint.useCustomUrls} onChange={(e) => onPatch({ useCustomUrls: e.target.checked })} className="h-4 w-4" />{t.customUrls}</label>
      {endpoint.useCustomUrls ? <div className="grid gap-4 sm:grid-cols-2"><label className="text-xs font-medium text-zinc-600">{embedding ? t.embeddingsUrl : t.chatUrl}<input value={embeddingEndpoint ? embeddingEndpoint.embeddingsUrl : chatEndpoint!.chatCompletionsUrl} onChange={(e) => embedding ? onPatch({ embeddingsUrl: e.target.value }) : onPatch({ chatCompletionsUrl: e.target.value })} className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100" /></label><label className="text-xs font-medium text-zinc-600">{t.modelsUrl}<input value={endpoint.modelsUrl} onChange={(e) => onPatch({ modelsUrl: e.target.value })} className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100" /></label></div> : null}
      <div className={`rounded-md border px-3 py-2 text-[11px] ${urls ? "border-zinc-200 bg-zinc-50 text-zinc-600" : "border-rose-200 bg-rose-50 text-rose-700"}`}>{urls ? <><p className="truncate">{embedding ? t.finalEmbeddingsUrl : t.finalChatUrl}: {urls.primary}</p><p className="mt-1 truncate">{t.finalModelsUrl}: {urls.models || "—"}</p></> : t.invalidUrl}</div>
      <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 p-3"><div className="flex flex-wrap items-end gap-2"><label className="min-w-52 flex-1 text-xs font-medium text-zinc-600">{embedding ? t.embeddingModel : t.model}<select value={selectedModel} onChange={(e) => embedding ? onPatch({ embeddingModel: e.target.value }) : onPatch({ defaultModel: e.target.value })} className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100"><option value="">{t.noModel}</option>{selectedModel && !endpoint.models.includes(selectedModel) ? <option value={selectedModel}>{selectedModel}</option> : null}{endpoint.models.map((model) => <option key={model}>{model}</option>)}</select></label><button type="button" onClick={onFetch} disabled={!urls?.models || busy} className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />{t.fetchModels}</button><button type="button" onClick={onTest} disabled={!urls?.primary || !selectedModel || testing} className={`inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${embedding ? "border-violet-200 bg-violet-50 text-violet-800 hover:bg-violet-100" : "border-cyan-200 bg-cyan-50 text-cyan-800 hover:bg-cyan-100"}`}>{testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}{testing ? t.testing : embedding ? t.testEmbedding : t.test}</button></div>
        <div className="mt-3 flex gap-2"><input value={manualModel} onChange={(e) => onManualModel(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onAddModel(); } }} placeholder={t.addModelPlaceholder} className="h-9 min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100" /><button type="button" onClick={onAddModel} className="inline-flex h-9 items-center gap-1 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50"><Plus className="h-3.5 w-3.5" />{t.add}</button></div>
        {endpoint.models.length ? <div className="mt-3 flex flex-wrap gap-2">{endpoint.models.map((model) => <span key={model} className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-700">{model}<button type="button" onClick={() => onPatch({ models: endpoint.models.filter((item) => item !== model), ...(embedding ? { embeddingModel: selectedModel === model ? "" : selectedModel } : { defaultModel: selectedModel === model ? "" : selectedModel }) })} className="text-zinc-400 transition-colors hover:text-rose-600"><X className="h-3 w-3" /></button></span>)}</div> : <p className="mt-3 text-xs text-zinc-500">{t.noModels}</p>}
      </div>
    </div>
  </section>;
}

export default function AppSettingsDialog({ open, locale, onClose, onSaved, initialTab = "endpoints" }: {
  open: boolean; locale: Locale; onClose: () => void; onSaved: (config: AiConfigDto) => void; initialTab?: SettingsTab;
}) {
  const t = labels[locale];
  const { showAlert, showConfirm, dialogElement } = useAppDialog({ confirm: t.confirm, cancel: t.cancel });
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [config, setConfig] = useState<ConfigDraft | null>(null);
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false);
  const [busyEndpoint, setBusyEndpoint] = useState<string | null>(null); const [testingEndpoint, setTestingEndpoint] = useState<string | null>(null);
  const [manualModels, setManualModels] = useState<Record<string, string>>({}); const [visibleKeys, setVisibleKeys] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!open) return; const timer = window.setTimeout(() => { setLoading(true); setTab(initialTab); }, 0);
    fetch("/api/settings/ai", { cache: "no-store" }).then(async (response) => {
      const result = await response.json().catch(() => null) as { config?: AiConfigDto; error?: string } | null;
      if (!response.ok || !result?.config) throw new Error(result?.error ?? t.loadFailed); setConfig(toDraft(result.config));
    }).catch((error) => { setConfig(toDraft({ version: AI_CONFIG_VERSION, endpoints: [], embeddingEndpoints: [], activeEndpointId: null, activeEmbeddingEndpointId: null,
      skills: { ocrRefinement: { prompt: DEFAULT_OCR_REFINEMENT_PROMPT, modelOverride: "" }, readingCompanion: { prompt: DEFAULT_READING_COMPANION_PROMPT, modelOverride: "" }, subtitleKnowledge: { prompt: DEFAULT_SUBTITLE_KNOWLEDGE_PROMPT, modelOverride: "", retryModelOverride: "", disableReasoning: true, maxOutputTokens: 3000 } },
      skillReady: { ocrRefinement: false, readingCompanion: false, subtitleKnowledge: false }, embeddingReady: false, ready: false }));
      void showAlert({ title: t.operationFailed, message: error instanceof Error ? error.message : t.loadFailed, tone: "danger" });
    }).finally(() => setLoading(false)); return () => window.clearTimeout(timer);
  }, [initialTab, open, showAlert, t.loadFailed, t.operationFailed]);
  useEffect(() => { if (!open) return; const listener = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving) onClose(); }; window.addEventListener("keydown", listener); return () => window.removeEventListener("keydown", listener); }, [onClose, open, saving]);
  const activeEndpoint = useMemo(() => config?.endpoints.find((endpoint) => endpoint.id === config.activeEndpointId) ?? null, [config]);
  if (!open) return dialogElement;

  const updateEndpoint = (mode: "chat" | "embedding", id: string, patch: EndpointPatch) => setConfig((current) => current ? mode === "chat"
    ? { ...current, endpoints: current.endpoints.map((endpoint) => endpoint.id === id ? { ...endpoint, ...patch } : endpoint) }
    : { ...current, embeddingEndpoints: current.embeddingEndpoints.map((endpoint) => endpoint.id === id ? { ...endpoint, ...patch } : endpoint) } : current);
  function addEndpoint(mode: "chat" | "embedding") { setConfig((current) => { if (!current) return current; if (mode === "chat") { const endpoint = createChatEndpoint(); return { ...current, endpoints: [...current.endpoints, endpoint], activeEndpointId: current.activeEndpointId ?? endpoint.id }; } const endpoint = createEmbeddingEndpoint(); return { ...current, embeddingEndpoints: [...current.embeddingEndpoints, endpoint], activeEmbeddingEndpointId: current.activeEmbeddingEndpointId ?? endpoint.id }; }); }
  async function deleteEndpoint(mode: "chat" | "embedding", endpoint: EndpointDraft) { if (!await showConfirm({ title: t.deleteTitle, message: t.deleteMessage, tone: "danger", confirmLabel: t.delete })) return; setConfig((current) => { if (!current) return current; if (mode === "chat") { const endpoints = current.endpoints.filter((item) => item.id !== endpoint.id); return { ...current, endpoints, activeEndpointId: current.activeEndpointId === endpoint.id ? endpoints[0]?.id ?? null : current.activeEndpointId }; } const endpoints = current.embeddingEndpoints.filter((item) => item.id !== endpoint.id); return { ...current, embeddingEndpoints: endpoints, activeEmbeddingEndpointId: current.activeEmbeddingEndpointId === endpoint.id ? endpoints[0]?.id ?? null : current.activeEmbeddingEndpointId }; }); }
  async function fetchModels(mode: "chat" | "embedding", endpoint: EndpointDraft) { const key = `${mode}:${endpoint.id}`; setBusyEndpoint(key); try { const response = await fetch(mode === "chat" ? "/api/settings/ai/models" : "/api/settings/ai/embedding-models", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: requestValue(endpoint) }) }); const result = await response.json().catch(() => null) as { models?: string[]; error?: string } | null; if (!response.ok || !result?.models) throw new Error(result?.error ?? t.operationFailed); const models = [...new Set([...endpoint.models, ...result.models])].sort((a, b) => a.localeCompare(b)); updateEndpoint(mode, endpoint.id, { models, ...(mode === "chat" ? { defaultModel: "defaultModel" in endpoint ? endpoint.defaultModel || models[0] || "" : "" } : { embeddingModel: "embeddingModel" in endpoint ? endpoint.embeddingModel || models[0] || "" : "" }) }); } catch (error) { await showAlert({ title: t.operationFailed, message: error instanceof Error ? error.message : t.operationFailed, tone: "danger" }); } finally { setBusyEndpoint(null); } }
  async function testConnection(mode: "chat" | "embedding", endpoint: EndpointDraft) { const model = mode === "chat" && "defaultModel" in endpoint ? endpoint.defaultModel : "embeddingModel" in endpoint ? endpoint.embeddingModel : ""; if (!model) return; const key = `${mode}:${endpoint.id}`; setTestingEndpoint(key); try { const response = await fetch(mode === "chat" ? "/api/settings/ai/test" : "/api/settings/ai/test-embedding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: requestValue(endpoint), model }) }); const result = await response.json().catch(() => null) as { error?: string } | null; if (!response.ok) throw new Error(result?.error ?? t.operationFailed); await showAlert({ title: t.testSuccess, message: mode === "chat" ? t.testChatSuccess : t.testEmbeddingSuccess, tone: "success" }); } catch (error) { await showAlert({ title: t.operationFailed, message: error instanceof Error ? error.message : t.operationFailed, tone: "danger" }); } finally { setTestingEndpoint(null); } }
  function addManualModel(mode: "chat" | "embedding", endpoint: EndpointDraft) { const key = `${mode}:${endpoint.id}`; const model = manualModels[key]?.trim(); if (!model) return; const models = [...new Set([...endpoint.models, model])].sort((a, b) => a.localeCompare(b)); updateEndpoint(mode, endpoint.id, { models, ...(mode === "chat" ? { defaultModel: "defaultModel" in endpoint ? endpoint.defaultModel || model : model } : { embeddingModel: "embeddingModel" in endpoint ? endpoint.embeddingModel || model : model }) }); setManualModels((current) => ({ ...current, [key]: "" })); }
  async function save() { if (!config) return; setSaving(true); try { const response = await fetch("/api/settings/ai", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: AI_CONFIG_VERSION, endpoints: config.endpoints.map(requestValue), embeddingEndpoints: config.embeddingEndpoints.map(requestValue), activeEndpointId: config.activeEndpointId, activeEmbeddingEndpointId: config.activeEmbeddingEndpointId, skills: config.skills }) }); const result = await response.json().catch(() => null) as { config?: AiConfigDto; error?: string } | null; if (!response.ok || !result?.config) throw new Error(result?.error ?? t.saveFailed); onSaved(result.config); onClose(); } catch (error) { await showAlert({ title: t.operationFailed, message: error instanceof Error ? error.message : t.saveFailed, tone: "danger" }); } finally { setSaving(false); } }

  const renderEndpoints = (mode: "chat" | "embedding") => { if (!config) return null; const endpoints: EndpointDraft[] = mode === "chat" ? config.endpoints : config.embeddingEndpoints; return <div className="space-y-4"><div className="flex justify-end"><button type="button" onClick={() => addEndpoint(mode)} className="inline-flex h-9 items-center gap-2 rounded-md bg-cyan-800 px-4 text-sm font-medium text-white transition-colors hover:bg-cyan-900"><Plus className="h-4 w-4" />{mode === "chat" ? t.addChatEndpoint : t.addEmbeddingEndpoint}</button></div>{!endpoints.length ? <div className="grid min-h-48 place-items-center rounded-lg border border-dashed border-zinc-300 bg-zinc-50/50 text-sm text-zinc-500">{mode === "chat" ? t.chatEmpty : t.embeddingEmpty}</div> : null}{endpoints.map((endpoint) => { const key = `${mode}:${endpoint.id}`; return <EndpointCard key={key} mode={mode} endpoint={endpoint} active={mode === "chat" ? config.activeEndpointId === endpoint.id : config.activeEmbeddingEndpointId === endpoint.id} t={t} busy={busyEndpoint === key} testing={testingEndpoint === key} manualModel={manualModels[key] ?? ""} keyVisible={visibleKeys.has(key)} onActivate={() => setConfig((current) => current ? mode === "chat" ? { ...current, activeEndpointId: endpoint.id } : { ...current, activeEmbeddingEndpointId: endpoint.id } : current)} onPatch={(patch) => updateEndpoint(mode, endpoint.id, patch)} onDelete={() => void deleteEndpoint(mode, endpoint)} onFetch={() => void fetchModels(mode, endpoint)} onTest={() => void testConnection(mode, endpoint)} onManualModel={(value) => setManualModels((current) => ({ ...current, [key]: value }))} onAddModel={() => addManualModel(mode, endpoint)} onToggleKey={() => setVisibleKeys((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; })} />; })}</div>; };

  const renderSkills = () => {
    if (!config) return null;
    const definitions = [
      { key: OCR_REFINEMENT_SKILL_KEY, title: t.skillTitle, description: t.skillDescription, privacy: t.privacy },
      { key: READING_COMPANION_SKILL_KEY, title: t.readingSkillTitle, description: t.readingSkillDescription, privacy: t.readingPrivacy },
      { key: SUBTITLE_KNOWLEDGE_SKILL_KEY, title: t.subtitleSkillTitle, description: t.subtitleSkillDescription, privacy: t.subtitlePrivacy },
    ] as const;
    return <div className="space-y-4">{definitions.map((definition) => {
      const skill = config.skills[definition.key];
      const subtitleSkill = definition.key === SUBTITLE_KNOWLEDGE_SKILL_KEY
        ? config.skills.subtitleKnowledge
        : null;
      const modelOptions = activeEndpoint?.models ?? [];
      return <section key={definition.key} className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold">{definition.title}</h3>
        <p className="mt-1 text-xs text-zinc-500">{definition.description}</p>
        <label className="mt-5 block text-xs font-medium text-zinc-600">{t.modelOverride}<select value={skill.modelOverride} onChange={(e) => setConfig((current) => current ? { ...current, skills: { ...current.skills, [definition.key]: { ...skill, modelOverride: e.target.value } } } : current)} className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100"><option value="">{t.inheritModel}</option>{skill.modelOverride && !modelOptions.includes(skill.modelOverride) ? <option>{skill.modelOverride}</option> : null}{modelOptions.map((model) => <option key={model}>{model}</option>)}</select></label>
        {subtitleSkill ? <div className="mt-4 grid gap-4 rounded-lg border border-violet-200 bg-violet-50/40 p-4 sm:grid-cols-2">
          <label className="text-xs font-medium text-zinc-600">{t.retryModel}<select value={subtitleSkill.retryModelOverride} onChange={(e) => setConfig((current) => current ? { ...current, skills: { ...current.skills, subtitleKnowledge: { ...current.skills.subtitleKnowledge, retryModelOverride: e.target.value } } } : current)} className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100"><option value="">{t.inheritModel}</option>{subtitleSkill.retryModelOverride && !modelOptions.includes(subtitleSkill.retryModelOverride) ? <option>{subtitleSkill.retryModelOverride}</option> : null}{modelOptions.map((model) => <option key={model}>{model}</option>)}</select><span className="mt-1 block text-[11px] font-normal text-zinc-500">{t.retryModelHint}</span></label>
          <label className="text-xs font-medium text-zinc-600">{t.maxOutputTokens}<input type="number" min={512} max={3000} step={128} value={subtitleSkill.maxOutputTokens} onChange={(e) => setConfig((current) => current ? { ...current, skills: { ...current.skills, subtitleKnowledge: { ...current.skills.subtitleKnowledge, maxOutputTokens: Number(e.target.value) } } } : current)} className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100" /><span className="mt-1 block text-[11px] font-normal leading-4 text-zinc-500">{t.maxOutputTokensHint}</span></label>
          <p className="flex items-center gap-2 text-xs font-medium text-emerald-800 sm:col-span-2"><Check className="h-4 w-4" />{t.disableReasoning}</p>
        </div> : null}
        <label className="mt-4 block text-xs font-medium text-zinc-600">{t.prompt}<textarea value={skill.prompt} onChange={(e) => setConfig((current) => current ? { ...current, skills: { ...current.skills, [definition.key]: { ...skill, prompt: e.target.value } } } : current)} className="mt-1 min-h-52 w-full resize-y rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm leading-6 outline-none transition focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100" /></label>
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{definition.privacy}</p>
      </section>;
    })}</div>;
  };

  return <>
    <div className="fixed inset-0 z-40 grid place-items-center bg-zinc-950/50 p-4 sm:p-6" role="dialog" aria-modal="true" onClick={() => !saving && onClose()}>
      <div className="flex max-h-[min(52rem,calc(100vh-2rem))] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-start justify-between border-b border-zinc-200 px-5 py-4">
          <div><h2 className="flex items-center gap-2 font-semibold"><Settings className="h-4 w-4 text-cyan-700" />{t.title}</h2><p className="mt-1 text-sm text-zinc-500">{t.subtitle}</p></div>
          <button type="button" onClick={onClose} disabled={saving} className="grid h-8 w-8 place-items-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50"><X className="h-4 w-4" /></button>
        </header>
        <div className="grid min-h-0 flex-1 md:grid-cols-[12rem_minmax(0,1fr)]">
          <nav className="border-b border-zinc-200 bg-zinc-50 p-3 md:border-b-0 md:border-r md:border-zinc-200">
            <button type="button" className="flex h-10 w-full items-center gap-2 rounded-md bg-white px-3 text-sm font-medium text-cyan-800 shadow-sm ring-1 ring-zinc-200"><Sparkles className="h-4 w-4" />{t.ai}</button>
          </nav>
          <div className="flex min-h-0 flex-col">
            <div className="flex gap-1 border-b border-zinc-200 px-5 pt-3">
              {(["endpoints", "embeddings", "skills"] as const).map((item) => <button key={item} type="button" onClick={() => setTab(item)} className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${tab === item ? "border-cyan-700 text-cyan-800" : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800"}`}>{t[item]}</button>)}
            </div>
            <main className="min-h-0 flex-1 overflow-y-auto p-5">
              {loading || !config ? <div className="grid min-h-64 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-cyan-700" /></div> : tab === "endpoints" ? renderEndpoints("chat") : tab === "embeddings" ? renderEndpoints("embedding") : renderSkills()}
            </main>
            <footer className="flex justify-end gap-2 border-t border-zinc-200 bg-zinc-50 px-5 py-3">
              <button type="button" onClick={onClose} disabled={saving} className="h-9 rounded-md border border-zinc-200 bg-white px-4 text-sm text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50 disabled:opacity-50">{t.cancel}</button>
              <button type="button" onClick={() => void save()} disabled={saving || loading || !config} className="inline-flex h-9 items-center gap-2 rounded-md bg-cyan-800 px-4 text-sm font-medium text-white transition-colors hover:bg-cyan-900 disabled:cursor-not-allowed disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{saving ? t.saving : t.save}</button>
            </footer>
          </div>
        </div>
      </div>
    </div>
    {dialogElement}
  </>;
}
