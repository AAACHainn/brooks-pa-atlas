"use client";

import {
  Check,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  RefreshCw,
  Settings,
  Sparkles,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useAppDialog } from "@/app/app-dialog";
import {
  AI_CONFIG_VERSION,
  type AiConfigDto,
  type AiEndpointDto,
  type AiProvider,
  DEFAULT_OCR_REFINEMENT_PROMPT,
  DEFAULT_READING_COMPANION_PROMPT,
  OCR_REFINEMENT_SKILL_KEY,
  READING_COMPANION_SKILL_KEY,
  resolveAiEndpointUrls,
} from "@/lib/ai-config";

type Locale = "zh" | "en";
type SettingsTab = "endpoints" | "skills";
type EndpointDraft = AiEndpointDto & {
  apiKey: string;
  clearApiKey: boolean;
};

type ConfigDraft = Omit<AiConfigDto, "endpoints"> & { endpoints: EndpointDraft[] };

const labels = {
  zh: {
    title: "设置",
    subtitle: "配置应用功能与外部服务",
    ai: "AI 配置",
    endpoints: "端点",
    skills: "技能",
    addEndpoint: "新增端点",
    endpointEmpty: "还没有 AI 端点，请先新增一个端点。",
    active: "启用",
    name: "名称",
    provider: "服务商",
    openai: "OpenAI",
    deepseek: "DeepSeek",
    custom: "自定义",
    baseUrl: "API Base URL",
    baseUrlHint: "系统会在 Base URL 后追加 /chat/completions 和 /models。",
    customUrls: "分别填写完整请求地址",
    chatUrl: "Chat Completions URL",
    modelsUrl: "Models URL（可选）",
    finalChatUrl: "最终对话地址",
    finalModelsUrl: "最终模型地址",
    apiKey: "API Key（可选）",
    keyStored: "已保存密钥；留空将保持不变。",
    keyNotStored: "未保存密钥；本地服务可以留空。",
    clearKey: "清除已保存密钥",
    undoClearKey: "取消清除",
    fetchModels: "拉取模型",
    testing: "测试中",
    test: "测试连接",
    testSuccess: "连接成功",
    testSuccessMessage: "端点已成功返回 Chat Completions 响应。此测试不验证图片输入能力。",
    model: "默认模型",
    noModel: "请选择模型",
    addModelPlaceholder: "输入模型 ID",
    add: "添加",
    noModels: "暂无模型，可拉取或手动添加。",
    skillTitle: "AI 精校 OCR",
    skillDescription: "结合原图校对当前 OCR 草稿。模型返回结果后只更新未保存草稿。",
    readingSkillTitle: "AI 阅读伴侣",
    readingSkillDescription: "结合当前图片及其全部学习资料，进行翻译、讲解、比较和讨论。",
    prompt: "提示词",
    modelOverride: "模型覆盖",
    inheritModel: "继承启用端点的默认模型",
    privacy: "精校时会把当前图片和 OCR 文本发送到启用的外部端点。",
    readingPrivacy: "伴读时会把近期会话、参考图片及其标签、备注、OCR、标注、索引属性发送到启用的外部端点。",
    cancel: "取消",
    save: "保存设置",
    saving: "保存中",
    loadFailed: "无法加载 AI 设置。",
    saveFailed: "无法保存 AI 设置。",
    operationFailed: "操作失败",
    invalidUrl: "请检查端点地址。",
    deleteTitle: "删除 AI 端点？",
    deleteMessage: "删除后，该端点的本地配置和密钥将一并移除。",
    delete: "删除",
    confirm: "确认",
    close: "关闭",
  },
  en: {
    title: "Settings",
    subtitle: "Configure app features and external services",
    ai: "AI configuration",
    endpoints: "Endpoints",
    skills: "Skills",
    addEndpoint: "Add endpoint",
    endpointEmpty: "No AI endpoints yet. Add one to get started.",
    active: "Active",
    name: "Name",
    provider: "Provider",
    openai: "OpenAI",
    deepseek: "DeepSeek",
    custom: "Custom",
    baseUrl: "API Base URL",
    baseUrlHint: "The app appends /chat/completions and /models to this URL.",
    customUrls: "Use full request URLs",
    chatUrl: "Chat Completions URL",
    modelsUrl: "Models URL (optional)",
    finalChatUrl: "Final chat URL",
    finalModelsUrl: "Final models URL",
    apiKey: "API Key (optional)",
    keyStored: "A key is stored. Leave this blank to keep it.",
    keyNotStored: "No key is stored. Local services can leave this blank.",
    clearKey: "Clear saved key",
    undoClearKey: "Keep saved key",
    fetchModels: "Fetch models",
    testing: "Testing",
    test: "Test connection",
    testSuccess: "Connection succeeded",
    testSuccessMessage: "The endpoint returned a Chat Completions response. Image input was not tested.",
    model: "Default model",
    noModel: "Select a model",
    addModelPlaceholder: "Enter a model ID",
    add: "Add",
    noModels: "No models yet. Fetch or add one manually.",
    skillTitle: "AI OCR refinement",
    skillDescription: "Proofread the current OCR draft against the image. Results remain unsaved until you save them.",
    readingSkillTitle: "AI reading companion",
    readingSkillDescription: "Translate, explain, compare, and discuss the current image with all saved study context.",
    prompt: "Prompt",
    modelOverride: "Model override",
    inheritModel: "Inherit active endpoint default",
    privacy: "Refinement sends the current image and OCR text to the active external endpoint.",
    readingPrivacy: "Reading companion sends recent conversation, reference images, tags, notes, OCR, annotations, and index attributes to the active external endpoint.",
    cancel: "Cancel",
    save: "Save settings",
    saving: "Saving",
    loadFailed: "Could not load AI settings.",
    saveFailed: "Could not save AI settings.",
    operationFailed: "Operation failed",
    invalidUrl: "Check the endpoint URLs.",
    deleteTitle: "Delete AI endpoint?",
    deleteMessage: "Its local configuration and saved API key will be removed.",
    delete: "Delete",
    confirm: "Confirm",
    close: "Close",
  },
} as const;

function toDraft(config: AiConfigDto): ConfigDraft {
  return {
    ...config,
    endpoints: config.endpoints.map((endpoint) => ({
      ...endpoint,
      apiKey: "",
      clearApiKey: false,
    })),
  };
}

function createEndpoint(): EndpointDraft {
  return {
    id: crypto.randomUUID(),
    name: "OpenAI",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    useCustomUrls: false,
    chatCompletionsUrl: "",
    modelsUrl: "",
    models: [],
    defaultModel: "",
    hasApiKey: false,
    apiKey: "",
    clearApiKey: false,
  };
}

function serializeDraft(config: ConfigDraft) {
  return {
    version: AI_CONFIG_VERSION,
    activeEndpointId: config.activeEndpointId,
    skills: config.skills,
    endpoints: config.endpoints.map(endpointRequestValue),
  };
}

function endpointRequestValue(endpoint: EndpointDraft) {
  return {
    id: endpoint.id,
    name: endpoint.name,
    provider: endpoint.provider,
    baseUrl: endpoint.baseUrl,
    useCustomUrls: endpoint.useCustomUrls,
    chatCompletionsUrl: endpoint.chatCompletionsUrl,
    modelsUrl: endpoint.modelsUrl,
    models: endpoint.models,
    defaultModel: endpoint.defaultModel,
    apiKey: endpoint.apiKey,
    clearApiKey: endpoint.clearApiKey,
  };
}

function providerDefaults(provider: AiProvider) {
  if (provider === "openai") return { name: "OpenAI", baseUrl: "https://api.openai.com/v1" };
  if (provider === "deepseek") return { name: "DeepSeek", baseUrl: "https://api.deepseek.com" };
  return { name: "Custom", baseUrl: "" };
}

export default function AppSettingsDialog({
  open,
  locale,
  onClose,
  onSaved,
  initialTab = "endpoints",
}: {
  open: boolean;
  locale: Locale;
  onClose: () => void;
  onSaved: (config: AiConfigDto) => void;
  initialTab?: SettingsTab;
}) {
  const t = labels[locale];
  const { showAlert, showConfirm, dialogElement } = useAppDialog({
    confirm: t.confirm,
    cancel: t.cancel,
  });
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [config, setConfig] = useState<ConfigDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyEndpoint, setBusyEndpoint] = useState<string | null>(null);
  const [testingEndpoint, setTestingEndpoint] = useState<string | null>(null);
  const [manualModels, setManualModels] = useState<Record<string, string>>({});
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!open) return;
    const tabTimer = window.setTimeout(() => setTab(initialTab), 0);
    fetch("/api/settings/ai", { cache: "no-store" })
      .then(async (response) => {
        const result = (await response.json().catch(() => null)) as
          | { config?: AiConfigDto; error?: string }
          | null;
        if (!response.ok || !result?.config) throw new Error(result?.error ?? t.loadFailed);
        setConfig(toDraft(result.config));
      })
      .catch((error) => {
        setConfig(
          toDraft({
            version: AI_CONFIG_VERSION,
            endpoints: [],
            activeEndpointId: null,
            skills: {
              [OCR_REFINEMENT_SKILL_KEY]: {
                prompt: DEFAULT_OCR_REFINEMENT_PROMPT,
                modelOverride: "",
              },
              [READING_COMPANION_SKILL_KEY]: {
                prompt: DEFAULT_READING_COMPANION_PROMPT,
                modelOverride: "",
              },
            },
            skillReady: {
              [OCR_REFINEMENT_SKILL_KEY]: false,
              [READING_COMPANION_SKILL_KEY]: false,
            },
            ready: false,
          }),
        );
        void showAlert({
          title: t.operationFailed,
          message: error instanceof Error ? error.message : t.loadFailed,
          tone: "danger",
        });
      })
      .finally(() => setLoading(false));
    return () => window.clearTimeout(tabTimer);
  }, [initialTab, open, showAlert, t.loadFailed, t.operationFailed]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open, saving]);

  const activeEndpoint = useMemo(
    () => config?.endpoints.find((endpoint) => endpoint.id === config.activeEndpointId) ?? null,
    [config],
  );

  if (!open) return dialogElement;

  function updateEndpoint(id: string, update: (endpoint: EndpointDraft) => EndpointDraft) {
    setConfig((current) =>
      current
        ? {
            ...current,
            endpoints: current.endpoints.map((endpoint) =>
              endpoint.id === id ? update(endpoint) : endpoint,
            ),
          }
        : current,
    );
  }

  function addEndpoint() {
    const endpoint = createEndpoint();
    setConfig((current) =>
      current
        ? {
            ...current,
            endpoints: [...current.endpoints, endpoint],
            activeEndpointId: current.activeEndpointId ?? endpoint.id,
          }
        : current,
    );
  }

  async function deleteEndpoint(endpoint: EndpointDraft) {
    const confirmed = await showConfirm({
      title: t.deleteTitle,
      message: t.deleteMessage,
      tone: "danger",
      confirmLabel: t.delete,
    });
    if (!confirmed) return;
    setConfig((current) => {
      if (!current) return current;
      const endpoints = current.endpoints.filter((item) => item.id !== endpoint.id);
      return {
        ...current,
        endpoints,
        activeEndpointId:
          current.activeEndpointId === endpoint.id ? (endpoints[0]?.id ?? null) : current.activeEndpointId,
      };
    });
  }

  function endpointPayload(endpoint: EndpointDraft) {
    return endpointRequestValue(endpoint);
  }

  async function fetchModels(endpoint: EndpointDraft) {
    setBusyEndpoint(endpoint.id);
    try {
      const response = await fetch("/api/settings/ai/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: endpointPayload(endpoint) }),
      });
      const result = (await response.json().catch(() => null)) as
        | { models?: string[]; error?: string }
        | null;
      if (!response.ok || !result?.models) throw new Error(result?.error ?? t.operationFailed);
      updateEndpoint(endpoint.id, (current) => {
        const models = [...new Set([...current.models, ...result.models!])].sort((a, b) =>
          a.localeCompare(b),
        );
        return { ...current, models, defaultModel: current.defaultModel || models[0] || "" };
      });
    } catch (error) {
      await showAlert({
        title: t.operationFailed,
        message: error instanceof Error ? error.message : t.operationFailed,
        tone: "danger",
      });
    } finally {
      setBusyEndpoint(null);
    }
  }

  async function testConnection(endpoint: EndpointDraft) {
    if (!endpoint.defaultModel) return;
    setTestingEndpoint(endpoint.id);
    try {
      const response = await fetch("/api/settings/ai/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: endpointPayload(endpoint), model: endpoint.defaultModel }),
      });
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? t.operationFailed);
      await showAlert({
        title: t.testSuccess,
        message: t.testSuccessMessage,
        tone: "success",
      });
    } catch (error) {
      await showAlert({
        title: t.operationFailed,
        message: error instanceof Error ? error.message : t.operationFailed,
        tone: "danger",
      });
    } finally {
      setTestingEndpoint(null);
    }
  }

  function addManualModel(endpoint: EndpointDraft) {
    const model = manualModels[endpoint.id]?.trim();
    if (!model) return;
    updateEndpoint(endpoint.id, (current) => ({
      ...current,
      models: [...new Set([...current.models, model])].sort((a, b) => a.localeCompare(b)),
      defaultModel: current.defaultModel || model,
    }));
    setManualModels((current) => ({ ...current, [endpoint.id]: "" }));
  }

  async function save() {
    if (!config) return;
    setSaving(true);
    try {
      const response = await fetch("/api/settings/ai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(serializeDraft(config)),
      });
      const result = (await response.json().catch(() => null)) as
        | { config?: AiConfigDto; error?: string }
        | null;
      if (!response.ok || !result?.config) throw new Error(result?.error ?? t.saveFailed);
      onSaved(result.config);
      onClose();
    } catch (error) {
      await showAlert({
        title: t.operationFailed,
        message: error instanceof Error ? error.message : t.saveFailed,
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40 grid place-items-center bg-zinc-950/50 p-4 sm:p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-settings-title"
        onClick={() => !saving && onClose()}
      >
        <div
          className="flex max-h-[min(52rem,calc(100vh-2rem))] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4">
            <div>
              <h2 id="app-settings-title" className="flex items-center gap-2 text-base font-semibold text-zinc-950">
                <Settings className="h-4 w-4" />
                {t.title}
              </h2>
              <p className="mt-1 text-sm text-zinc-500">{t.subtitle}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="grid h-8 w-8 place-items-center rounded-md text-zinc-500 hover:bg-zinc-100 disabled:opacity-50"
              aria-label={t.close}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid min-h-0 flex-1 md:grid-cols-[12rem_minmax(0,1fr)]">
            <nav className="border-b border-zinc-200 bg-zinc-50 p-3 md:border-b-0 md:border-r">
              <button
                type="button"
                className="flex h-10 w-full items-center gap-2 rounded-md bg-white px-3 text-left text-sm font-medium text-cyan-800 shadow-sm ring-1 ring-zinc-200"
              >
                <Sparkles className="h-4 w-4" />
                {t.ai}
              </button>
            </nav>

            <div className="flex min-h-0 flex-col">
              <div className="flex gap-1 border-b border-zinc-200 px-5 pt-3">
                {(["endpoints", "skills"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setTab(item)}
                    className={`border-b-2 px-4 py-2 text-sm font-medium ${
                      tab === item
                        ? "border-cyan-700 text-cyan-800"
                        : "border-transparent text-zinc-500 hover:text-zinc-800"
                    }`}
                  >
                    {t[item]}
                  </button>
                ))}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                {loading || !config ? (
                  <div className="grid min-h-64 place-items-center text-sm text-zinc-500">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                ) : tab === "endpoints" ? (
                  <div className="space-y-4">
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={addEndpoint}
                        className="inline-flex h-9 items-center gap-2 rounded-md bg-cyan-800 px-4 text-sm font-medium text-white hover:bg-cyan-900"
                      >
                        <Plus className="h-4 w-4" />
                        {t.addEndpoint}
                      </button>
                    </div>
                    {config.endpoints.length === 0 ? (
                      <div className="grid min-h-48 place-items-center rounded-md border border-dashed border-zinc-300 text-sm text-zinc-500">
                        {t.endpointEmpty}
                      </div>
                    ) : null}
                    {config.endpoints.map((endpoint) => {
                      let urls: { chatCompletionsUrl: string; modelsUrl: string } | null = null;
                      try {
                        urls = resolveAiEndpointUrls(endpoint);
                      } catch {
                        urls = null;
                      }
                      const keyVisible = visibleKeys.has(endpoint.id);
                      return (
                        <section key={endpoint.id} className="rounded-lg border border-zinc-200 bg-white shadow-sm">
                          <div className="flex items-center justify-between gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-3">
                            <label className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-900">
                              <input
                                type="radio"
                                name="active-ai-endpoint"
                                checked={config.activeEndpointId === endpoint.id}
                                onChange={() => setConfig((current) => current ? { ...current, activeEndpointId: endpoint.id } : current)}
                                className="h-4 w-4 border-zinc-300 text-cyan-700 focus:ring-cyan-700"
                              />
                              {endpoint.name || t.active}
                              {config.activeEndpointId === endpoint.id ? (
                                <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-[10px] font-semibold text-cyan-800">
                                  {t.active}
                                </span>
                              ) : null}
                            </label>
                            <button
                              type="button"
                              onClick={() => void deleteEndpoint(endpoint)}
                              className="grid h-8 w-8 place-items-center rounded-md text-rose-600 hover:bg-rose-50"
                              aria-label={t.delete}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                          <div className="space-y-4 p-4">
                            <div className="grid gap-4 sm:grid-cols-2">
                              <label className="block text-xs font-medium text-zinc-600">
                                {t.name}
                                <input
                                  value={endpoint.name}
                                  onChange={(event) => updateEndpoint(endpoint.id, (current) => ({ ...current, name: event.target.value }))}
                                  className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                                />
                              </label>
                              <label className="block text-xs font-medium text-zinc-600">
                                {t.provider}
                                <select
                                  value={endpoint.provider}
                                  onChange={(event) => {
                                    const provider = event.target.value as AiProvider;
                                    const defaults = providerDefaults(provider);
                                    updateEndpoint(endpoint.id, (current) => ({ ...current, provider, ...defaults }));
                                  }}
                                  className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-cyan-500"
                                >
                                  <option value="openai">{t.openai}</option>
                                  <option value="deepseek">{t.deepseek}</option>
                                  <option value="custom">{t.custom}</option>
                                </select>
                              </label>
                            </div>

                            <label className="block text-xs font-medium text-zinc-600">
                              {t.apiKey}
                              <div className="relative mt-1">
                                <input
                                  type={keyVisible ? "text" : "password"}
                                  value={endpoint.apiKey}
                                  onChange={(event) => updateEndpoint(endpoint.id, (current) => ({ ...current, apiKey: event.target.value, clearApiKey: false }))}
                                  className="h-10 w-full rounded-md border border-zinc-200 px-3 pr-10 text-sm outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                                  placeholder={endpoint.hasApiKey ? "••••••••••••" : "sk-..."}
                                />
                                <button
                                  type="button"
                                  onClick={() => setVisibleKeys((current) => {
                                    const next = new Set(current);
                                    if (next.has(endpoint.id)) next.delete(endpoint.id); else next.add(endpoint.id);
                                    return next;
                                  })}
                                  className="absolute right-1 top-1 grid h-8 w-8 place-items-center rounded text-zinc-500 hover:bg-zinc-100"
                                  aria-label={keyVisible ? t.close : t.apiKey}
                                >
                                  {keyVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </button>
                              </div>
                              <span className="mt-1 flex items-center justify-between gap-3 text-[11px] font-normal text-zinc-500">
                                <span>{endpoint.hasApiKey ? t.keyStored : t.keyNotStored}</span>
                                {endpoint.hasApiKey ? (
                                  <button
                                    type="button"
                                    onClick={() => updateEndpoint(endpoint.id, (current) => ({ ...current, clearApiKey: !current.clearApiKey, apiKey: "" }))}
                                    className={endpoint.clearApiKey ? "text-cyan-700" : "text-rose-600"}
                                  >
                                    {endpoint.clearApiKey ? t.undoClearKey : t.clearKey}
                                  </button>
                                ) : null}
                              </span>
                            </label>

                            <label className="block text-xs font-medium text-zinc-600">
                              {t.baseUrl}
                              <input
                                value={endpoint.baseUrl}
                                disabled={endpoint.useCustomUrls}
                                onChange={(event) => updateEndpoint(endpoint.id, (current) => ({ ...current, baseUrl: event.target.value }))}
                                className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-cyan-500 disabled:bg-zinc-100 disabled:text-zinc-400"
                              />
                              <span className="mt-1 block text-[11px] font-normal text-zinc-500">{t.baseUrlHint}</span>
                            </label>
                            <label className="flex items-center gap-2 text-xs font-medium text-zinc-700">
                              <input
                                type="checkbox"
                                checked={endpoint.useCustomUrls}
                                onChange={(event) => updateEndpoint(endpoint.id, (current) => ({ ...current, useCustomUrls: event.target.checked }))}
                                className="h-4 w-4 rounded border-zinc-300 text-cyan-700 focus:ring-cyan-700"
                              />
                              {t.customUrls}
                            </label>
                            {endpoint.useCustomUrls ? (
                              <div className="grid gap-4 sm:grid-cols-2">
                                <label className="block text-xs font-medium text-zinc-600">
                                  {t.chatUrl}
                                  <input
                                    value={endpoint.chatCompletionsUrl}
                                    onChange={(event) => updateEndpoint(endpoint.id, (current) => ({ ...current, chatCompletionsUrl: event.target.value }))}
                                    className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-cyan-500"
                                  />
                                </label>
                                <label className="block text-xs font-medium text-zinc-600">
                                  {t.modelsUrl}
                                  <input
                                    value={endpoint.modelsUrl}
                                    onChange={(event) => updateEndpoint(endpoint.id, (current) => ({ ...current, modelsUrl: event.target.value }))}
                                    className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-cyan-500"
                                  />
                                </label>
                              </div>
                            ) : null}
                            <div className={`rounded-md border px-3 py-2 text-[11px] ${urls ? "border-zinc-200 bg-zinc-50 text-zinc-600" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
                              {urls ? (
                                <>
                                  <p className="truncate" title={urls.chatCompletionsUrl}>{t.finalChatUrl}: {urls.chatCompletionsUrl}</p>
                                  <p className="mt-1 truncate" title={urls.modelsUrl}>{t.finalModelsUrl}: {urls.modelsUrl || "—"}</p>
                                </>
                              ) : t.invalidUrl}
                            </div>

                            <div className="rounded-md border border-zinc-200 p-3">
                              <div className="flex flex-wrap items-end gap-2">
                                <label className="min-w-52 flex-1 text-xs font-medium text-zinc-600">
                                  {t.model}
                                  <select
                                    value={endpoint.defaultModel}
                                    onChange={(event) => updateEndpoint(endpoint.id, (current) => ({ ...current, defaultModel: event.target.value }))}
                                    className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-cyan-500"
                                  >
                                    <option value="">{t.noModel}</option>
                                    {endpoint.models.map((model) => <option key={model} value={model}>{model}</option>)}
                                  </select>
                                </label>
                                <button
                                  type="button"
                                  onClick={() => void fetchModels(endpoint)}
                                  disabled={!urls?.modelsUrl || busyEndpoint === endpoint.id}
                                  className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-200 px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                                >
                                  <RefreshCw className={`h-4 w-4 ${busyEndpoint === endpoint.id ? "animate-spin" : ""}`} />
                                  {t.fetchModels}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void testConnection(endpoint)}
                                  disabled={!urls?.chatCompletionsUrl || !endpoint.defaultModel || testingEndpoint === endpoint.id}
                                  className="inline-flex h-10 items-center gap-2 rounded-md border border-cyan-200 bg-cyan-50 px-3 text-sm font-medium text-cyan-800 hover:bg-cyan-100 disabled:opacity-50"
                                >
                                  {testingEndpoint === endpoint.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                                  {testingEndpoint === endpoint.id ? t.testing : t.test}
                                </button>
                              </div>
                              <div className="mt-3 flex gap-2">
                                <input
                                  value={manualModels[endpoint.id] ?? ""}
                                  onChange={(event) => setManualModels((current) => ({ ...current, [endpoint.id]: event.target.value }))}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                      event.preventDefault();
                                      addManualModel(endpoint);
                                    }
                                  }}
                                  placeholder={t.addModelPlaceholder}
                                  className="h-9 min-w-0 flex-1 rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-cyan-500"
                                />
                                <button type="button" onClick={() => addManualModel(endpoint)} className="inline-flex h-9 items-center gap-1 rounded-md border border-zinc-200 px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
                                  <Plus className="h-3.5 w-3.5" /> {t.add}
                                </button>
                              </div>
                              {endpoint.models.length ? (
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {endpoint.models.map((model) => (
                                    <span key={model} className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs text-zinc-700">
                                      {model}
                                      <button
                                        type="button"
                                        onClick={() => updateEndpoint(endpoint.id, (current) => ({
                                          ...current,
                                          models: current.models.filter((item) => item !== model),
                                          defaultModel: current.defaultModel === model ? "" : current.defaultModel,
                                        }))}
                                        className="text-zinc-400 hover:text-rose-600"
                                        aria-label={`${t.delete} ${model}`}
                                      >
                                        <X className="h-3 w-3" />
                                      </button>
                                    </span>
                                  ))}
                                </div>
                              ) : <p className="mt-3 text-xs text-zinc-500">{t.noModels}</p>}
                            </div>
                          </div>
                        </section>
                      );
                    })}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {([
                      {
                        key: OCR_REFINEMENT_SKILL_KEY,
                        title: t.skillTitle,
                        description: t.skillDescription,
                        privacy: t.privacy,
                      },
                      {
                        key: READING_COMPANION_SKILL_KEY,
                        title: t.readingSkillTitle,
                        description: t.readingSkillDescription,
                        privacy: t.readingPrivacy,
                      },
                    ] as const).map((skillDefinition) => {
                      const skill = config.skills[skillDefinition.key];
                      return (
                        <section key={skillDefinition.key} className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
                          <div className="flex items-start gap-3">
                            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-cyan-200 bg-cyan-50 text-cyan-700">
                              <Sparkles className="h-5 w-5" />
                            </div>
                            <div>
                              <h3 className="text-sm font-semibold text-zinc-950">{skillDefinition.title}</h3>
                              <p className="mt-1 text-xs leading-5 text-zinc-500">{skillDefinition.description}</p>
                            </div>
                          </div>
                          <label className="mt-5 block text-xs font-medium text-zinc-600">
                            {t.modelOverride}
                            <select
                              value={skill.modelOverride}
                              onChange={(event) => setConfig((current) => current ? {
                                ...current,
                                skills: {
                                  ...current.skills,
                                  [skillDefinition.key]: {
                                    ...current.skills[skillDefinition.key],
                                    modelOverride: event.target.value,
                                  },
                                },
                              } : current)}
                              className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-cyan-500"
                            >
                              <option value="">{t.inheritModel}</option>
                              {skill.modelOverride && !activeEndpoint?.models.includes(skill.modelOverride) ? (
                                <option value={skill.modelOverride}>{skill.modelOverride}</option>
                              ) : null}
                              {activeEndpoint?.models.map((model) => <option key={model} value={model}>{model}</option>)}
                            </select>
                          </label>
                          <label className="mt-4 block text-xs font-medium text-zinc-600">
                            {t.prompt}
                            <textarea
                              value={skill.prompt}
                              onChange={(event) => setConfig((current) => current ? {
                                ...current,
                                skills: {
                                  ...current.skills,
                                  [skillDefinition.key]: {
                                    ...current.skills[skillDefinition.key],
                                    prompt: event.target.value,
                                  },
                                },
                              } : current)}
                              className="mt-1 min-h-52 w-full resize-y rounded-md border border-zinc-200 px-3 py-2 text-sm leading-6 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                            />
                          </label>
                          <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                            {skillDefinition.privacy}
                          </p>
                        </section>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 border-t border-zinc-200 bg-zinc-50 px-5 py-3">
                <button type="button" onClick={onClose} disabled={saving} className="inline-flex h-9 items-center rounded-md border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">
                  {t.cancel}
                </button>
                <button type="button" onClick={() => void save()} disabled={saving || loading || !config} className="inline-flex h-9 items-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  {saving ? t.saving : t.save}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      {dialogElement}
    </>
  );
}
