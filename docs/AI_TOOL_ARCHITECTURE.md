# AI 工具调用基础设施

本基础设施让设置中的 API 模型通过 Function Calling 请求系统操作，由服务端验证并执行。当前只支持 Chat Completions，不增加 MCP、Responses API、通用工具执行路由或 Server Action；执行器自身不依赖持久化表，机器人会话使用独立 migration。

图片、索引及知识库只读工具是正式内部能力，已经通过独立全局机器人接入；OCR、快速/深度伴读、字幕整理和知识库继续原流程。机器人拥有独立技能设置、会话与专用接口，原有业务能力和接口保留，机器人消息增加可选知识引用快照。

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

默认读取已有设置的启用端点和默认模型。可指定 `skill: "readingCompanion" | "ocrRefinement" | "subtitleKnowledge"`，沿用其提示词和模型覆盖；字幕技能仍关闭推理。独立机器人调用此入口；既有伴读/OCR/知识业务不调用此入口，深度模式原预算、租约和流程不变。内部可信调用方/测试可以传入已保存的 `config` 快照；不允许浏览器传入密钥或执行函数。

机器人执行器与 OCR、伴读、字幕服务共用 `resolveAiModelSelection`：覆盖模型若只属于其他端点已知模型列表、当前启用端点已有模型列表且未列出它，则本次使用当前端点默认模型。保留保存的覆盖值，切回原端点可继续使用；当前端点明确列出的模型及未知手动模型保持覆盖优先。设置和 ready 状态使用同一选择规则。

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

`AiToolTraceSink.write(record)` 是未来存储扩展口；执行器自身返回运行内记录，不直接写会话或数据库；机器人调用方保存成功运行的脱敏摘要。记录包含运行、轮次、调用、资源 ID，端点/模型标识，状态、耗时、数量/大小和 Token 摘要；不包含密钥、原始响应、参数正文、资料正文或思考正文。sink 收到独立副本，异常产生 trace_sink_failed 警告，不改变业务读取结果。取消后的最终记录在返回结果中，调用方可补存。

`probeAiToolSupport` 使用临时无副作用工具，验证参数、结果回传，以及模型是否返回工具生成的新 receipt。返回 supported/unsupported/unconfirmed/failed；连接或协议故障不能当作已支持。探测可能产生 API 费用，只由可信调用方显式触发，不随启动、保存设置或既有连接测试自动执行。

## 验证

`npm run test:ai-tools` 使用模拟端点与隔离数据库，覆盖协议、真实读取、授权、多轮、预算、取消、超时和脱敏，使用 react-server 条件加载服务端模块。`npm run test:ai` 包含此专项；`npm run test:knowledge` 验证已有知识与字幕兼容性。测试不发起真实付费调用，不读取/修改用户图库；清理只删除单个明确文件路径。

## 全局机器人接入

机器人专用接口 `/api/ai/robot/conversations/**` 调用 `runAiToolTask`；它不是通用工具执行 HTTP API。请求只接收问题、语言及可选当前图片/索引 ID，服务端验证并固定选择、保存配置快照，使用 `globalRobot` 技能及全库只读范围。普通模式白名单包含 `get_image_context`、`list_index_nodes`、`list_knowledge_documents`、`search_knowledge`、`read_knowledge`，普通问题可直接回答，不自动检索。

管理设置的机器人技能提供折叠的“高级运行限制”：模型/工具次数、单次/累计输入 Token、单次输出 Token、总时长。默认分别为 6/12、16000/100000、4096、300 秒，可快捷设置 12/24 次调用；该按钮不改变输入预算。字段范围为模型 1–50 次、工具 1–200 次、单次输入 1–1000000、累计输入 1–10000000、输出 1–131072、总时长 30–1800 秒，累计预算不得低于单次预算。限制只传给机器人，每次发送固定，不能由发送 body 或模型参数扩大。旧 v4 配置补默认值，旧保存请求省略新字段时保留当前值，无数据库迁移。

机器人显式启用 `finishNearLimit`。执行器在最后一次请求、剩余工具次数不超过总数 15%、单次可用输入或累计输入已达 85%、总时长已达 80% 时提示收束，并通过 `tool_choice: "none"` 请求已有证据支持的最终答案；收束指令本身也计入预算，仍须通过硬预算校验。收束阶段再请求工具会停止并报告 `final_answer_required`，不会执行或额外请求模型。现有内部执行器调用默认不启用收束，原有硬限制与探测协议不变。

`budget_warning` 与完成 trace 携带 `AiToolBudgetSnapshot`，只含固定限制、调用次数、输入估算、耗时、成功工具名称/次数/数量以及未完成调用数。超限细分 `limitKind` 为 model_calls/tool_calls/input_tokens/total_input_tokens/run_time。窗口显示已完成的读取与尚未生成最终答案的事实，不推测未执行工作的内容。成功收束的历史保存 warnings/budget；失败不保存助手草稿。用户可手动按当前配置重试原问题/原参考对象，或继续提问更小范围；这里没有自动续跑或检查点恢复。

机器人图片工具使用分页模式：fields 可指定 metadata/ocr/notes/annotations/index，offset 对文字按 Unicode 字符计数、列表按项目计数；limit 默认 2000、最大 4000，列表最多 20 项。pages 标记完整总数、当前返回量和 nextOffset，不把省略部分冒充完整资料。索引工具在同一事务返回过滤后精确 total，数量问题无需逐页读取；其原每页 20、最多 50 和资源授权规则保持一致。

`ai-robot-service.ts` 编排最近四组完整问答与当前问题、独立选择快照和最终答案保存；`ai-robot-runs.ts` 提供每会话互斥及跨 Route Handler 的取消控制（单进程全局状态）。清空/删除持有互斥并取消旧运行；禁用设置取消所有活动机器人运行。服务端在保存前和事务内检查租约及取消信号，防止迟到草稿写入。运行中间正文和 tool 结果不作为持久化聊天消息回放。

`AiRobotConversation` / `AiRobotMessage` 由 migration `20261006100000_ai_robot` 创建，与伴读分表。成功回复保存可见思考及 `runId`、调用统计、Token 估算和脱敏 trace；不保存密钥、原始上游响应、参数或资料正文到执行日志；知识正文另存在 `knowledgeContextJson` 的版本化引用快照。失败只保留用户问题。两类会话都不进入备份。

已有实例未迁移时，会话初始化不能成功，因此尚未进入模型调用。专用接口统一返回脱敏 JSON 错误；缺表/字段为 HTTP 503、`code: "storage_upgrade_required"`。前端显示当前语言的升级提示，并提供重新加载会话；不会在普通请求中自动执行数据库迁移。

前端 NDJSON 区分 `user_message`、带运行/轮次的 `delta`、`trace`、`done`、`error` 和 `ping`；新轮次替换中间正文，最终消息以 `done` 为准。客户端不执行模型指令。工具名称通过产品文字映射展示，不显示原始参数。

新增工具时先注册服务端定义与业务服务，再显式更新 `robotAllowedTools`、资源授权策略和 `robotToolLabel` 展示映射，补充隔离测试；不要自动开放注册表中的全部工具。写操作和日志访问仍需后续功能设计，本版不预设其授权或确认流程。

配置升级为 v5（兼容 v1–v4）：`skills.globalRobot` 默认启用、独立提示词、模型覆盖为空；旧 JSON 自动补齐，旧保存请求缺失该技能时保留现值。工具能力不支持时明确失败，不自动能力探测或解析文本指令。专项命令 `npm run test:ai-robot`。


## 统一窗口与持久任务

普通、伴读、任务分别维护会话，伴读嵌入复用原请求链，不经过工具执行器。普通白名单显式加入资料目录、混合检索和知识正文读取。

任务规划使用 `list_index_nodes`、`list_images`、`list_knowledge_documents`、`search_knowledge` 的只读工具；执行以确认后的不可变 manifest 为范围，按资源指纹和分页游标读取索引文字、图片文字资料和知识片段，范围同时显示资源数量与资料页覆盖。继续以及综合结果提交前重新校验已完成资源，资料变化时保留检查点并暂停。`read_task_source` 只接受 manifest 内的引用标识，不能读取任意文件。原始资料和工具结果始终属于不可信参考。

`AiRobotTask` 保存目标、计划版本、runId、revision、范围、预算和终态；`AiRobotTaskCheckpoint` 每批事务提交摘要和证据快照。模型及工具使用量在调用前持久计费，失败/取消也计入预算。运行时间每秒持久化，重启保留最近计时快照，不计服务停机或暂停时间。减少笔记上下文的分层汇总同样保存检查点，不截断成“全量已覆盖”。未知 T 引用被标记为未验证。

任务创建：`POST /api/ai/robot/conversations/[id]/tasks`；列表支持 `before`；轻量进度：`GET /api/ai/robot/tasks/[id]`，展开证据使用 `?evidence=true`。控制：`POST /api/ai/robot/tasks/[id]/actions`，body 为 action、revision、planVersion，重新规划另带 feedback。action 支持 start/pause/resume/cancel/replan；旧状态返回 409。

执行不依赖浏览器连接。全局重任务租约确保单任务，暂停取消当前上游、使 runId 失效，恢复前等待旧 worker 退出。迟到结果不会写入。服务启动仅标记无 worker 的运行任务为暂停。设置关闭机器人、清空和删除会话均先停止后台任务。检查点与会话不导入导出备份。


## 知识库工具与引用快照（2026-10-09）

`knowledge-retrieval.ts` 共用 FTS/关键词/向量通道、相关性门槛、RRF 和正文投影；快速伴读仍最多 8 个来源，深度伴读保留原流程与预算。机器人使用 `createKnowledgeToolSession` 创建运行内状态，通过 `createSystemToolRegistry({knowledgeRegistry})` 显式接入；缺省系统注册表仍只提供原图片和索引工具。

| 工具 | 参数与分页 | 结果 |
| --- | --- | --- |
| `list_knowledge_documents` | query、scope、documentIds、offset、limit（20，最多50） | 有效文档 ID、课号、标题、版本、索引位置、片段数、精确文档 total、nextOffset；无正文 |
| `search_knowledge` | query、scope、documentIds、offset、limit（5，最多10） | 最多500 Unicode 字符摘录、版本与出处、totalCandidates（排序候选池，最多100）、nextOffset、semanticSearchUsed 和 warnings |
| `read_knowledge` | target（kind=chunk + chunkId/versionId，或 kind=document + documentId/versionId/可选 headingPath）、scope、documentIds、cursor、limitChars（2000，最多4000） | 原顺序正文页、实际字符范围及 nextCursor；章节路径按前缀精确匹配 |

scope 默认为 library，优先当前索引及可继承祖先；current 只限这些关联资料，无选择时返回空；documents 必须有 documentIds。指定 ID 必须在服务端授权集合内。所有通道在召回前限制到已启用、ACTIVE 版本、有效绑定且主库节点实际存在的文档，不能先取全库候选再过滤。只有图片选择时在提交时固定其索引。泛化图片问题不使用 OCR 生成全库检索主题。

每个会话运行缓存相同查询/范围的排序结果，资料版本或范围变化会报告 source_changed 并要求重查；正文续读游标限定到原目标、版本及范围。返回页按完整 JSON 字节限制装载，nextOffset 根据实际返回条数继续。candidate total、摘录和部分页都不能表示全库或全文覆盖。

Embedding 使用本次固定配置；缺少活动 profile、端点不匹配或请求失败时以全文/关键词降级。失败的请求也计入独立 Embedding 请求次数与保守输入估算（不是实际供应商用量），同一查询续页不重复请求。任务规划在发出请求前持久保存这两个值，对话模型计数与预算仍沿用原口径。取消、工具期限保持硬终止，不触发向量重建。

执行器增加可选同步 `onToolSucceeded(toolName, output)` 服务端回调，仅在参数、资源、大小和取消检查后通知，传入独立副本；不作为 trace/NDJSON 原始资料事件。普通机器人用它收集真正成功返回的正文页，按版本/片段/字符范围/正文去重，分配本运行的 K 引用。过大或失败结果不进入引用快照，未知 K 引用标记为未验证。

主库 migration `20261009000000_robot_knowledge_sources` 只增加 `AiRobotMessage.knowledgeContextJson` 可空字段。`RobotMessage.knowledge` 为版本1快照，保存 sources（正文、版本、locator、字符范围、partial）、warnings 和 retrieval 统计；成功答案与快照事务保存，历史资料更新/删除不影响旧快照。执行日志不保存资料正文；历史上下文仅附带引用身份和位置，重新引用时须读当前有效资料。旧消息为空，聊天仍不进入业务备份。

任务规划使用同一资料目录和混合搜索，摘录不计为执行覆盖；确认后的 manifest、read_task_source、T 引用和检查点照旧。知识工具不会加入 OCR、伴读或字幕的工具白名单。
