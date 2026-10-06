# AI 工具调用基础设施

本基础设施让设置中的 API 模型通过 Function Calling 请求系统操作，由服务端验证并执行。当前只支持 Chat Completions，不增加 MCP、Responses API、公开执行路由、Server Action 或数据库迁移。

两个只读工具是正式内部能力；本阶段通过隔离测试验收，未接入聊天、OCR、快速/深度伴读、字幕整理或知识库界面。原有能力、设置和 HTTP 返回格式不变。

## 分层

1. `ai-model-types.ts` 定义与供应商分离的消息、调用、工具描述、Token 用量和模型事件。
2. `ai-client.ts` 负责协议请求与响应：`createAiModelTurn` 返回完整单轮结果，`streamAiModelTurn` 输出 content/reasoning/tool_call_delta/complete。旧文本接口共享实现，但不传工具参数、不执行工具。
3. `ai-tool-registry.ts` 使用 strict Zod 对象 schema 注册工具，以 `z.toJSONSchema` 生成参数定义，服务端依然校验实际参数。工具名称唯一，每次运行使用明确白名单。
4. `ai-tool-runtime.ts` 的 `runAiToolTask` 固定配置和上下文，组装 assistant 调用消息、执行工具、回传结果，直到最终回答或明确失败。
5. `ai-system-tools.ts` 包装已有业务读取能力。注册层不依赖 HTTP 路由，未来协议/MCP 适配可以复用。

注册、执行、系统读取及探测模块使用 `server-only` 防止客户端误导入。不要添加 `"use server"`：本阶段需要内部函数，不需要可远程调用的 Server Action。

## 服务端接入

以下示例只能放在未来显式启用工具的服务端功能中，不能直接接入现有伴读流程：

```ts
import { createSystemToolRegistry } from "@/lib/ai-system-tools";
import { runAiToolTask } from "@/lib/ai-tool-runtime";

const result = await runAiToolTask({
  registry: createSystemToolRegistry(),
  allowedTools: ["get_image_context", "list_index_nodes"],
  context: {
    currentImageId: submittedImageId,
    currentIndexNodeId: submittedIndexNodeId,
    scope: {
      kind: "selection",
      imageIds: [submittedImageId],
      indexNodeIds: submittedIndexNodeId ? [submittedIndexNodeId] : [],
    },
  },
  messages: [{ role: "user", content: question }],
  signal: requestSignal,
});
```

默认读取已有设置的启用端点和默认模型。可指定 `skill: "readingCompanion" | "ocrRefinement" | "subtitleKnowledge"`，沿用其提示词和模型覆盖；字幕技能仍关闭推理。既有业务不调用此入口，深度模式原预算、租约和流程不变。内部可信调用方/测试可以传入已保存的 `config` 快照；不允许浏览器传入密钥或执行函数。

`context` 必须显式提供 nullable 当前图片/索引 ID 和范围。`selection` 使用精确 ID，不自动包含后代；全库读取须明确使用 `{ kind: "library" }`。前端模式不是授权凭证，接入方必须在服务端确定范围。选择、消息、工具描述和配置在开始时固定，之后切图不改变本次任务的对象。图片资料在实际读取时查询最新保存值，不读取旧聊天快照。

返回 `runId/status/answer/error`、模型/工具/成功工具数量、估算与实际 Token、结构化 `records` 和 `warnings`。只有 completed 包含最终答案；cancelled、timed_out、limit_exceeded、failed 的 answer 为 null。上游不报告用量时保留 null，不能当作零费用。

`onEvent` 输出带 runId/round 的文字与思考增量，以及执行元数据。增量可能属于中间轮次，不能当作成功最终答案保存；不输出完整工具参数。

## 首批工具

| 名称 | 参数 | 返回 |
| --- | --- | --- |
| `get_image_context` | `imageId`，非空且最多 200 字符 | `imageId/indexNodeId/snapshot`：标题、标签、OCR、备注、标注、索引属性和技术元数据；不包含路径或图片字节 |
| `list_index_nodes` | 可选 `query/parentId/offset/limit` | `nodes`（id/name/path/parentId）与 nullable `nextOffset` |

索引默认 offset=0、limit=20，上限 50。省略 parentId 搜索全部已授权节点，null 表示根节点，明确 ID 表示直属子节点；父节点也须在授权集合中。关键词按字面量匹配名称/路径，全部参数绑定，百分号、下划线和反斜杠不能扩大搜索范围。

注册新工具使用 `defineAiTool`，提供 name/description/effect/parameters/execute/summarize。parameters 必须是 strict Zod 对象 schema；execute 仍须校验具体资源并响应 signal；summarize 只返回 resourceIds/itemCount，不返回正文。当前 write 工具不能加入白名单；未来写操作的授权、预览、幂等和撤销另行设计。

## 执行规则

- SSE 按 index 合并交错参数，文字和思考独立保留；单调用参数最多 1Mi 字符。调用 ID 必须完整且在任务内唯一。
- 完整模型轮次结束后才执行。截断、内容过滤、缺失完成标记或结构错误终止；JSON 回退允许正文为空的工具调用。允许的供应商思考字段保留用于回传，与展示文本分离。
- assistant 调用消息先进入上下文，工具按返回顺序串行执行，结果以匹配的 tool_call_id 回传。结果是 `{ok:true,data}` 或 `{ok:false,error:{code,message}}`，是不可信参考数据。
- 未知/越权工具、无效 JSON/schema、越权资源、读取失败或结果过大可由模型修正；不能原样透传异常、路径或上游正文。普通文本即使长得像调用 JSON，也不会执行。
- 默认最多模型/工具调用 6/12 次，模型/工具/运行期限 120s/30s/300s，单次/累计输入预算 16000/100000 Token，输出上限 4096 Token。单次输入保留 10% 余量。可信调用方可以覆盖 limits，但不能提高供应商容量。
- 按 UTF-8 字节/2 保守估算输入，包含工具描述、消息、参数和结果；图片每张预留 4096 Token。失败模型尝试也计入累计估算，不静默删除问题或参数来满足预算。
- 单工具成功结果最多 32KiB；过大时完整替换为错误，不截断 JSON。处理函数应分页或提供较小读取能力。工具批次超过剩余调用数量时，整个批次不执行。
- 取消传递给上游和工具，并在执行前后检查。即使依赖不响应取消，执行器也会按期限终止编排；处理函数仍须配合 signal 停止自身工作。首版没有写工具，不承诺可中断未来任意文件/数据库写操作。

## 记录与能力探测

`AiToolTraceSink.write(record)` 是未来存储扩展口；当前返回运行内记录，不写会话或数据库。记录包含运行、轮次、调用、资源 ID，端点/模型标识，状态、耗时、数量/大小和 Token 摘要；不包含密钥、原始响应、参数正文、资料正文或思考正文。sink 收到独立副本，异常产生 trace_sink_failed 警告，不改变业务读取结果。取消后的最终记录在返回结果中，调用方可补存。

`probeAiToolSupport` 使用临时无副作用工具，验证参数、结果回传，以及模型是否返回工具生成的新 receipt。返回 supported/unsupported/unconfirmed/failed；连接或协议故障不能当作已支持。探测可能产生 API 费用，只由可信调用方显式触发，不随启动、保存设置或既有连接测试自动执行。

## 验证

`npm run test:ai-tools` 使用模拟端点与隔离数据库，覆盖协议、真实读取、授权、多轮、预算、取消、超时和脱敏，使用 react-server 条件加载服务端模块。`npm run test:ai` 包含此专项；`npm run test:knowledge` 验证已有知识与字幕兼容性。测试不发起真实付费调用，不读取/修改用户图库；清理只删除单个明确文件路径。
