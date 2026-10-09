# 售前项目工作台

React + TypeScript + Vite 本地原型。全部项目共用 F1–F13 流程、资料与工件、关注事项、里程碑及变更日志。版本管理贯穿流程；F5 / F3S 软件工作区重点演示。

项目流程的路线、岗位和写回/接收门槛集中在 `src/lib/workflowEngine.ts`。F2 可并行交付 F3/F4/F5/F6；F14 贯穿全流程。每份工件单独交接和失效，详细测试版边界见 Obsidian《测试版架构与流程引擎方案》。

不同岗位同事并行修改的文件边界、分支和 PR 检查见 [CONTRIBUTING_ROLES.md](./CONTRIBUTING_ROLES.md)。当前先验证软件 F5 独立界面，其他岗位暂不按环节拆代码。

公开 Git 仓库只管理源码与演示逻辑。本机 `public/project-data/`、`public/shared/` 中的真实项目资料和预览不提交到 GitHub；克隆仓库后相关预览需要从授权的本地资料目录重新准备。Mock 操作、路由和结构化测试不依赖这些大文件。此仓库目前未附开源许可证，公开可读不等于获得复制、修改或再分发授权。

## 本机协作 API 切片

`server/app.py` 提供 FastAPI 测试服务：上传 PDF/UTF-8 文件、按页查看原文、关键词或 Kimi 提取候选要求、软件产品核对、销售/研发/解决方案交接答复、应答批准与写回，以及新版本对旧要求的局部失效。它使用 SQLite 保存本机演示数据，单文件上限 100 MB。F5 页面已接入这组接口，项目流程图的 F5 进度也读取服务端；其他环节及原有浏览器 Mock 工件仍使用浏览器演示数据，不能互相视为已写回。这仍不是正式认证或完整文档解析。

先按下方「运行」步骤克隆仓库，再在第二个终端启动本机 API：

```sh
cd presales-workbench
python3 -m venv .venv
.venv/bin/pip install -r server/requirements.txt
.venv/bin/uvicorn app:app --app-dir server --host 127.0.0.1 --port 8000
```

接口文档为 http://127.0.0.1:8000/docs 。演示账号与前端相同，统一密码 `demo2026`。先启动 API，再从前端登录，F5 默认进入本机资料核对；无 API 时默认进入浏览器 Mock 演示。Rack Central 可点击「导入本机 BMS 原件」读取已放在 `public/project-data/rcjm1/` 的实际 PDF，不会把原件提交进 Git；原件缺失时可手动上传 PDF/UTF-8 文件。随后执行候选提取、核对原文、派发问题；接收岗位在「我的任务」收到待答复事项，进入同一来源要求后提交意见；软件产品在任务页看到待处理答复，复核后完成批准与写回。浏览器仅在当前标签页会话保存本机 API token。数据默认写入被 Git 忽略的 `server/.local/`，可用 `PRESALES_DATA_DIR` 指向其他本地目录。停止服务用终端 Ctrl+C。

### 接入 DeepSeek / Kimi API

软件 F5 已有“询问 Agent → 查看逐字原文引用 → 提取候选 → 人工核对与交接”的入口。默认优先使用服务端配置的 DeepSeek Key；未配置 DeepSeek 而配置了 Kimi Key 时使用 Kimi。问答和提取只读取所选原文页的前 12,000 字符，回答不会自动修改工件；只有核对清单中的人工批准才能写回。

DeepSeek Key 在 [DeepSeek 开放平台](https://platform.deepseek.com/)创建。将 `.env.example` 复制为仓库根目录的 `.env.local`，填写 `DEEPSEEK_API_KEY`；默认接口为 `https://api.deepseek.com`，模型为 `deepseek-flash`。如需固定供应商，设置 `PRESALES_MODEL_PROVIDER=deepseek` 或 `kimi`；默认 `auto`。修改后重启本机 API，再用设置页“测试服务端连接”。不要把 Key 粘贴到聊天、浏览器连接设置或提交到 GitHub。

向企业的 Kimi 开放平台管理员确认 API 账号及可用额度，再到 [Kimi 开放平台](https://platform.kimi.com/) 的 API Keys 页面创建 API Key。所需的是**开放平台 API Key**，不是网页登录密码或浏览器 Cookie。企业聊天账号与 API 权限可能分开，需管理员确认。

如使用 Kimi，在 `.env.local` 填写 `MOONSHOT_API_KEY`。默认模型为 `kimi-k2.6`，接口为 `https://api.moonshot.cn/v1`；企业分配其他模型或专用地址时修改对应项。`.env.local` 已被 Git 忽略。服务端 `POST /api/model/test` 只发送固定短句 `Reply with ok.`，不发送项目原文。

软件账号进入项目 F5，选择原文文件及页码，在问答区提问或点击「提取本页要求」。模型回答和候选的引用必须逐字匹配原文；每页最多接收 12 条候选。软件产品仍需逐条核对、纠正、交接、批准后才能写回。提取失败保留原有候选；无 Key 时可用关键词提取演示。其他节点、全局对话和全部历史文档尚未接真实模型。

```sh
cd server
PYTHONDONTWRITEBYTECODE=1 ../.venv/bin/python -m unittest -v test_app.py
```

Mock 提取扫描所有可解析页面，按页限量生成技术关键词候选（最多 200 条），并标明 `coverage=keyword_only`；不保证全文覆盖或语义正确。导入时缓存页文本，候选可按页定位原文、搜索与按状态筛选。未核对候选可重新提取；已有人工处理记录时必须上传新版本，不能覆盖复核结果。原文核对与客户应答批准是两次不同的动作。正式版需以项目成员身份、数据库事务、对象存储、后台解析及可选的 LangGraph/AG-UI 扩展本机实现。

## 运行

新同事需要先安装 Node.js 和 Python 3，然后在自己的电脑上获取源码。仅在 GitHub 浏览代码不会运行页面；每个人的 `127.0.0.1` 都指向自己的电脑。

```sh
git clone https://github.com/Ponceau5/presales-workbench.git
cd presales-workbench
npm ci
npm run dev
```

默认 http://127.0.0.1:3000 。停止：运行终端 Ctrl+C。

```sh
npm run build
npm run lint
npm run test
```

生产产物为 dist/，使用支持 SPA 回退的 HTTP 服务。

## 账号

密码统一 `demo2026`。登录后身份固定，退出后更换账号。

| 账号 | 岗位 |
| --- | --- |
| sales | 销售 |
| solution | 解决方案 |
| hardware | 硬件产品 |
| software | 软件产品 |
| commercial | 商务支持 |
| finance | 财务 / 风控 |
| logistics | 货运关务 |
| dev | 研发 |
| legal | 认证 / 法务 |
| pm | PM / PO |

前端账号用于演示，不能替代生产认证。项目、软件复核、交接与操作记录保存在同一浏览器的本地共享存储，并在标签页之间同步；登录身份留在各自标签页会话，原始资料不改写。Key 仅在 React 内存中保存，刷新或退出清空。

## 演示

1. 共享监控 → 我的任务 → 指定项目、节点和工件。未生成成果也有待开始入口；专业岗位按负责工件处理，PM 按节点协调。
2. Agent 面板选择来源、当前工件、参数或关联答复，执行岗位相关的提取、核对、草稿和交接。记录输入、目标、版本、账号和时间；输入或参数变化使旧结果失效。
3. 候选先采用到编辑区，再保存、登记依据、专业批准和写回。未保存编辑不会被候选覆盖。软件客户应答、澄清、研发路径、服务器规格分别复核。
4. 发起专业跟进 → 接收岗位提交结果 → 发起人收到待处理答复 → 返回原工件核对。答复进入 Agent 输入，不自动批准工件。
5. F1 销售和商务分别批准自己的成果，必要确认和共同批准齐备后才可写回。服务器演算未验证时不写入正式规格事实。
6. 变更日志提供全文版本对比与本地规则摘要；真实配置比较技术工作表，排除价格/成本。受影响工件重新复核。
7. 全局助手快捷键 ⌘J / Ctrl+J；节点对话携带当前工件。跟进建议需确认，不绕过专业审批。

Rack Central 有 1,856 个真实文件索引约 6.24GB；公共资料独立分类。目录、搜索、筛选、50 行分页支持浏览，规格书定位 PDF 页，点表与配置表在对应节点“资料”页查看。没有复制全部文件或实现 CAD 自动解析。

## 浏览器 Mock / Live 连接测试

浏览器 Mock 无 Key 可演示原有节点业务。设置中的 Live 只测试 OpenAI-compatible chat/completions 连接，业务仍是 Mock；测试只发送 `Reply with ok.`，不发送业务资料。F5 问答与提取是独立的服务端真实模型业务入口，使用 `.env.local` 中的 Key。本仓库不包含真实 Key，供应商连通与模型输出需在配置后实测。

浏览器直连 Key 仅适合 prototype；正式版必须使用服务端 runtime。Key 不写入代码、文档、持久存储或审计。

## 接 FastAPI + LangGraph / AG-UI

- `src/lib/agentTasks.ts`：任务语义与结构化结果；替换 executeAgentTask 为服务端请求，传 projectId、stage、artifactId、revision、授权输入 ID、task、request。
- `src/components/NodeAgent.tsx`：工件任务、输入选择、候选采用、专业交接。
- `src/components/ProjectAssistant.tsx`：全局对话与工件上下文。
- `src/lib/projectTasks.ts`：专业待办、PM 协调与答复回流。
- `src/components/ReferenceWorkbench.tsx`、`src/pages/StageWorkbench.tsx`：人审工作区。
- `src/state/workbench.ts`、`src/lib/accounts.ts`、`src/lib/projectReview.ts`：权限、版本、人审和审计规则。

FastAPI 管理身份、项目 ACL、Key、文档版本、审批和审计；不信任浏览器权限。LangGraph 编排读取→提取→匹配→计算/转换→差异→人工确认→写回。确认前检查当前工件版本，避免覆盖并发修改。AG-UI 返回进度、依据、候选、待确认与交接事件。海量文件采用服务端分页、权限检索和预览，不继续打包前端。

尚未实现统一前后端事实池、真实多人并发、CRM/CM 写入、对外发送、生产认证或真实 Agent runtime。正式职责见 QUESTIONS.md，角色试用覆盖与限制见 ROLE_REVIEW.md。


## 多人交接演示

1. 在两个独立标签页登录不同账号（密码均为 `demo2026`）。
2. 销售在 F1 建立草稿、登记确认与依据、批准自己的项目档案；商务账号复核资料与有效版本。
3. 任一有权限的责任账号写回 F1，共同批准的两份输出自动交付 F2 的解决方案和软件岗位。
4. 接收人从“我的任务 → 待接收”或项目“协作交接”查看全文、版本与依据，填写接收说明或退回原因。
5. 接收后，下一环节 Agent 的“输入范围”包含交接快照。未接收输出不进入 Agent 上下文。
6. 上游修改对应工件，旧交接立即显示版本失效；已接收的失效输入阻止下游写回。新版重新复核交付后，接收新版会关闭该岗位旧版交接。
7. F2 分流至 F3/F4/F5/F6，并行开展；F6 同时向成本和合同环节提供输入。软件按工件类别分别交付，不把研发路径当客户应答。

`COLLABORATION_PLAN.md` 记录本轮规划和自审；实现入口为 `lib/collaboration.ts`（交接/失效）、`lib/sharedWorkspace.ts`（本机共享）、`components/Collaboration.tsx`（交接台/接收弹窗）及工作区的 `NodeAgent` 输入绑定。

这是本机协作原型，同源标签页可演示不同账号协作。跨电脑、并发事务、服务端认证、文件锁和推送尚未实现。接 FastAPI 时应将共享存储替换为数据库中的版本工件和交接事件，使用服务端角色权限与乐观锁；以 SSE/WebSocket 广播项目事件；LangGraph 执行时传入已接收且有效的工件快照，AG-UI 展示执行事件。API Key 和登录身份不进入共享存储。

## 软件要求与协作验证

F5 默认从要求跟进进入；关联澄清及研发工件必须发布后才能批准应答。研发确认包含实现方式及成本比较，客户结论独立复核。变更递归撤销关联批准并标记交接失效。详细范围与实际验证见 [SOFTWARE_FLOW_REVIEW.md](./SOFTWARE_FLOW_REVIEW.md)。

## 原始资料与提取核对

软件账号进入 F5 时默认打开“资料提取与核对”。选择 BMS 或 DCOM 文件 → 读取并提取要求 → 原文与候选要求并排核对、纠正 → 确认提取内容 → 进入专业判断。提取确认独立于产品满足批准；缺少原文核对时不能批准客户应答。来源、运行编号、执行时间、核对账号及修改前后内容留痕。

Mock 执行会读取本地文件的文本副本，然后载入预置的提取样例，**没有使用 LLM 自动解析完整规格书，也没有证明已覆盖所有要求**。运行记录与候选标签对此明确提示。专业跟进和客户应答仍按责任岗位确认。其他工作区默认从资料进入，并提供可点击流程和“核对”视图；只有部分项目资料支持正文预览，其他仍以活文件链接供人工核对。
