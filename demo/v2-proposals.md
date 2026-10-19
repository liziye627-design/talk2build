# Talk2Build demo v2：调研结果和案例方案（第一阶段，未录制）

写于 2026-10-19（北京时间）。基于 HEAD 2f80875 的代码。没有 commit、push，也没有录制。

## 1. App 现状速览

**它能演示什么**

- **主页**（`meeting-home.tsx`）：仿腾讯会议，有加入、快速会议、预定、"2:17 演练"入口。
- **会议室**（`meeting-stage.tsx`）：
  - 左边是深色宫格。大家都没开摄像头，只有字母头像，画面大部分是空的灰块。
  - 右边是 340px 宽的助手面板，三个页签：`工作` / `记录` / `变更`（变更只在 incident 场景出现）。
  - 底部是控制栏，`更多` 菜单里有"播放 2:17 演练 / 播放一段工作会话"。
- **普通会议的流程**：发言 → `POST /api/meetings/:id/utterance` → `prepareAgentWork` → `extractMeetingTurn`。
  - mock 模式下抽取走 `recordedExtraction`：用正则匹配 billing-export 那 7 句台词，匹配不上再走 `keywordExtraction`。
  - 抽出的 job 交给 runner 在后台跑，状态依次是 Queued → Reading → Drafting → Saving，每步 420ms，可以用 `TALK2BUILD_JOB_PACE_MS` 调。
  - 跑完写出 artifact（md/svg）到 `data/workspaces/ws-<id>/`。卡片按"决策树"排：目标是根，plan/design/verify/research 是分支。
  - code 类 job 一律先 `confirm_ask`，等人说 yes 才动。闲聊会被搁置（parked）。
- **Evidence 卡**（`lib/evidence/*`）：会上一比较技术（"Express or Fastify, which is more popular?"），就去实时拉 GitHub stars、issues、release 和 npm/PyPI 下载量。
  - 画条形图，每个数字都带来源 URL 和抓取时间，缓存 10 分钟。
  - 随后自动出 Tech selection（待人确认）、Requirement review，以及一张确定性生成的 Conclusion 卡（标"基于证据自动生成"）。
  - **这是真实网络数据，不是 fixture**，可选的库只有 CATALOG 里那 10 个。
- **AI 席位**（Architect / Skeptic，`lib/seats/*`）：要模型 key 才能发言。mock 模式下是**离线**，只会回一句"当前不可用（离线：未配置模型密钥）"。所以没有 key 演不了"两个 AI 吵架"。
- **Incident 场景**（`id=demo`，`lib/incident.ts` + `classifier.ts` + `tools.ts`）：走一套和普通会议不同的 classifier → MCP tools 路径，固定 8 句台词。
  - 时间线标记 02:17，Redis 关联，还有一条 sparkline 小曲线。
  - `deploy_lookup` 找到 batch-reconcile v2.3（11:40 PM），先确认再 `diff_fetch`，红绿 diff 显示连接池 50→20、超时被删。
  - 记录根因，搁置闲聊，加两条待办，"open the PR" 之后出 PR 草稿：3 个文件，测试通过。
  - 有 checkpoint，说 `stop` / `不对` 会回滚一步并弹框。
  - **注意**：incident 场景下 `工作` 页签是空的（v1 第 100 秒那帧右边是一片空白），内容都在 `记录`（时间线）和 `变更`（diff/PR）里。
- **MCP**（`src/mcp/handler.ts`）：Streamable HTTP，协议 2025-11-25，`tools.ts` 里定义了 30 个工具。`src/alexa/client.ts` 是模拟的 Alexa+ MCP 客户端，网页上每句发言都通过它走一趟 `/mcp`。`alexa/addon-package/addon.json` 的 integration type 是 MCP。
- **任务台** `/tasks`：线程视图，以 SSE 流式显示计划、工具调用和回复。
- **模型**：没有 key 时，`resolveAgentBackend()` 返回 `fixture`，界面上的 trace 写着 `recorded-fixtures`。现在一直是这个状态。

**v1 画面的问题（看 contact.png 和抽帧）**

1. 80% 的画面是空灰宫格。真正有内容的右侧面板只占 340/1920，YouTube 上看不清字。
2. Agent 生成的 SVG（架构图、线框图）**界面上根本不渲染**，只显示一行路径 `design/architecture.svg`。最有画面感的产物没露脸。
3. 界面是中文，助手名是"Alexa+ 助手"，incident 回复是中文。
4. `更多` 菜单在 incident 场景里一直开着（`record.mjs` 点开以后，后面那下 mouse.click 没把它关掉）。
5. 案例本身（nightly billing export）太平淡，没有利害关系，没有反转。

## 2. 三个案例方案

所有方案都**留在 mock 模式**。凡是 fixture 产出的内容，旁白都不说"AI 实时生成"；片尾或 Devpost 写明"demo mode uses recorded fixtures"。

### 方案 A：Cyber Monday Meltdown（推荐）

**一句话钩子**：凌晨 2:17，Cyber Monday，下单接口 40% 报错，每分钟都在丢钱。工程师只管说话，Alexa+ 在会议里把根因找出来、修复 PR 写好。

**节奏（约 2:30）**

| 时间 | 画面 | 发生什么 |
|---|---|---|
| 0:00–0:08 | 片头卡（黑底红字） | "Cyber Monday. 2:17 AM. Checkout is failing." 右上角叠一个后期做的 "Revenue at risk" 计数器，标注 illustrative |
| 0:08–0:18 | 主页 → 进 incident 房间 | 主页一闪而过，进入 war room。房间名改成 "Checkout outage – war room" |
| 0:18–0:33 | `记录` 页签，局部放大 | A: "PagerDuty woke me at 2:17. Checkout 500s spiked to 40%." → 时间线落下 02:17 标记，Alexa+ 英文回复 |
| 0:33–0:48 | 放大 sparkline | B: "Redis connections started climbing at 2:15 — two minutes before the errors." → 显示 "Linked" 关联，Redis 曲线冲上去 |
| 0:48–1:03 | 切 `变更` 页签 | A: "Wasn't there a batch job deployed last night?" → deploy 卡：batch-reconcile v2.3，11:40 PM，release-bot。Alexa+ 问 "Want me to pull the diff?"（确认门） |
| 1:03–1:20 | 放大红绿 diff | B: "Yes, pull it." → `max_connections: 50 → 20`，`command_timeout` 被删，两处高亮 |
| 1:20–1:35 | **反转**：回滚弹框 | A 先说错一句（例如 "Root cause is the checkout timeout tweak."），马上改口 "Stop — 不对." → 回滚到上一个检查点，弹框 "Rolled back. What should it be instead?" → A 重说正确的根因。体现"人始终能叫停" |
| 1:35–1:45 | 字幕和搁置条 | B: "Is the pizza here yet? I'm starving." → 被搁置，不进计划（笑点） |
| 1:45–2:03 | `变更` → PR 卡 | 待办两条（pool alert、feature flag）。"Okay, open the PR." → PR 草稿：3 个文件，测试一项项变绿 ✓ |
| 2:03–2:15 | 结束会议 → 纪要 | 纪要带上根因、待办、PR。计数器停住 |
| 2:15–2:30 | 架构卡 + 片尾 | Voice (Alexa+) → MCP 2025-11-25 Streamable HTTP → 30 tools → workspace files，加 GitHub 地址 |

**展示的功能**：时间线和关联、deploy 查询、确认门（大操作先问）、红绿 diff、`stop`/`不对` 回滚、闲聊搁置、待办、PR 和测试、会议纪要、MCP 架构。Alexa+ 赛道评委最关心的"语音 → MCP 工具"链条最完整。

**需要的工作**

- incident 回复（`demo-script.ts` 的 REPLIES）、classifier 里的中文回复改成英文；场景文案改成 Cyber Monday / checkout（orders → checkout 只改文案，时间和数值不动，减少测试改动）。约 1 小时。
- 确认 `stop` 插在第 5 句之后能干净回滚，再重说一遍能继续走完 PR（录制脚本自己发 utterance，不用 `play-demo` 按钮，顺带解决 `更多` 菜单不关的问题）。约 1 小时，可能要小修 classifier。
- incident 场景下 `工作` 页签是空的：要么录制时直接切 `记录` / `变更`，要么让 `工作` 页签显示一张 "Incident status" 汇总卡（可选，约 1 小时）。
- 后期（`render.py`）：按场景裁切放大右侧面板（ffmpeg crop+scale，或者 Playwright 用 deviceScaleFactor 2 录再裁）；加烧录字幕；加 "Revenue at risk" 计数器（drawtext，标 illustrative）。约 2–3 小时。
- 英文 UI（见第 3 节）。

**风险 / 工作量**：风险**低**（引擎原生就支持，8 句台词已经跑通过）；工作量**中**，大约 1 天，含英文 UI。唯一的不确定点是回滚以后能不能接着走完。

### 方案 B：Framework Cage Match（真数据对决）

**一句话钩子**：两个工程师在会上吵 Express 还是 Fastify。Alexa+ 不站队，当场拉来**真实**的 GitHub 和 npm 数据，每个数字都带出处，最后由人拍板。

**节奏（约 2:30）**

| 时间 | 画面 | 发生什么 |
|---|---|---|
| 0:00–0:10 | 片头 | "Every meeting has this argument." |
| 0:10–0:25 | 进房间，说目标 | Maya: "Goal: ship the public API by Friday." → Plan 卡 |
| 0:25–0:45 | 架构 | Chris: "Sketch the architecture: gateway, API service, Postgres." → 架构卡（加了 SVG 预览才有画面） |
| 0:45–1:15 | **对决** | Chris: "Express. Everybody uses it." Priya: "Fastify is faster. Which is more popular, Express or Fastify?" → Evidence 卡进行中 → 条形图展开：stars、weekly downloads、latest release、last push，每行带 source 和 fetched at |
| 1:15–1:35 | 决策树分叉 | 两个候选并排；Tech selection "pending human"；Requirement review |
| 1:35–1:50 | 辩论按钮 | 点 "@architect @skeptic debate this" → 没有 key 时只有确定性的 Conclusion 卡（"generated from evidence, not an AI seat"）。必须照实说，否则就是虚构 |
| 1:50–2:00 | 搁置 | "Who's buying coffee?" → 搁置 |
| 2:00–2:15 | 人拍板 | "We're going with Fastify." → 决策记录写入，带说话人 |
| 2:15–2:30 | 纪要 + 片尾 | |

**展示的功能**：实时证据抓取（不编数字，这是最好的"诚实"卖点）、条形图、决策树分叉、"推荐不等于决定"、决策归属到人。

**需要的工作**：英文化 `decision-tree.tsx`、`evidence/display.ts`、`dispatch.ts` 里的"待人确认"等文案（2 小时）；新 Plan/架构台词的 fixture 分支（1 小时）；录制前 10 分钟内预热一次缓存，避开 GitHub 未认证每小时 60 次的限额。

**风险 / 工作量**：风险**中**。依赖实时网络，数字每次都会变；辩论在 mock 模式下只是静态卡，高潮会落空。工作量**低到中**，约半天到 1 天。

### 方案 C：Pizza-Deadline Game Jam（最酷，也最贵）

**一句话钩子**：三个朋友要在披萨送到前设计出一款小游戏 "Space Cat Courier"。他们只管聊，Alexa+ 出计划、架构图、游戏画面线框、Phaser 和 PixiJS 的选型证据，最后说一声 yes，就生成能玩的原型、跑通测试。

**节奏（约 2:30）**：目标 → Plan（0:15）；"main loop, input, levels" → 架构 SVG（0:20）；"the HUD shows fuel and parcels" → 游戏画面线框 SVG（0:20）；"Phaser or PixiJS, which is more popular?" → 真实 Evidence 条形图（0:25）；"Is the pizza here?" → 搁置（0:08）；"Feasible on mobile? Pull what we decided last time." → Feasibility 和 Research，引用昨天的决定（0:15）；"Scaffold it and run the tests" → 等确认 → "Yes" → 脚手架和 `node --test` 全绿（0:20）；最后切到浏览器，猫在屏幕上飞（0:15）；片尾（0:12）。

**展示的功能**：普通会议这一路几乎全部用上（plan/design/verify/research/evidence/code 确认门/搁置/记忆），外加"会开完，东西能玩"的爆点。

**需要的工作**：
- 新的 `recordedExtraction` 分支，6–7 句台词；
- 两个新 SVG 模板（游戏架构、HUD 线框）；
- CATALOG 加上 phaser 和 pixi.js；
- 普通会议的 `scaffold_code` 现在只写一个 `describeTask()` 空壳，要换成能玩的 canvas 游戏模板加测试；
- 工作区文件路由要能以正确的 content-type 返回 HTML，或者直接用 file:// 打开；
- 加 SVG 预览。

**风险 / 工作量**：风险**高**。mock 模式下游戏是预先写好的模板，如果旁白暗示是 AI 现场写的就是误导；照实说"template scaffold"又会削弱爆点。另外新代码多，测试也要跟着改。工作量**高**，约 1.5–2 天，距截止（10/24 03:00）只剩 4 天多，很紧。

### 排名和推荐

1. **A Cyber Monday Meltdown**：画面戏剧性最强（时间线、曲线、红绿 diff、测试变绿、回滚反转），引擎原生支持，fixture 只改文案，风险最低，最贴合 Alexa+ 加 MCP 的评审重点。
2. **B Framework Cage Match**：真实数据是很好的诚实卖点，但依赖网络，高潮（AI 辩论）在没有 key 时演不出来。
3. **C Game Jam**：创意最酷，但工作量和"把模板说成 AI 生成"的风险都最大。

**推荐 A。** 如果时间有富余，可以把 B 的 Evidence 条形图当作 15–20 秒的彩蛋，替换 v1 的任务台镜头：在一个普通会议里问一句 "Express or Fastify, which is more popular?"，展示真实带出处的数字。不管选哪个方案，都建议加两项通用改进：
- **SVG 产物预览**：卡片里直接用 `<img src="/api/workspaces/<id>/file?path=...">` 显示（约 1 小时，先确认路由的 content-type）；
- **后期局部放大加烧录字幕**：解决"面板太小看不清"的问题。

## 3. 英文 UI 工作量

**现状**：没有任何 i18n 框架，没有 locale 开关（`layout.tsx` 是 `lang="en"`，但字符串全是硬编码中文）。去掉测试文件，`src` 下约 **150 行含中文**，分布在 19 个文件里：

| 文件 | 行数 | 内容 |
|---|---|---|
| components/meeting-stage.tsx | 56 | 控制栏、页签、抽屉、席位面板、结论卡 |
| components/decision-tree.tsx | 36 | 种类和状态标签、证据表头、"待人确认" |
| components/meeting-home.tsx | 27 | 主页按钮、加入和预定对话框 |
| lib/classifier.ts | 19 | 一部分是回复文案（要翻），一部分是输入正则（不翻） |
| lib/demo-script.ts | 8 | incident 回复，方案 A 必改 |
| evidence/display.ts、seats/*、branding.ts、dispatch.ts、room-columns.tsx、meeting-room.tsx 等 | 约 30 | 失败标签、席位名、助手名、状态 |

**必须保留中文的部分**：输入解析的正则（`不对`、`停`、`确认`、`先别`、`就这么定了`、`记一下`、`架构师`、`质疑者`、`辩论`），以及 fixtures 里的中文关键词。这些是"听得懂中文"，不是界面文案，保留着反而是加分项。

**两个做法**

1. **直接改成英文**：约 2.5 小时改代码。另外 12 个测试文件里约 95 行断言的是中文文案（seats 38、b7-no-key 17、evidence-display 9……），要跟着改，约 1.5 小时。**合计约 4 小时。**
2. **轻量字典加开关（推荐）**：新建 `src/lib/ui-text.ts`，en 和 zh 两份，用 `NEXT_PUBLIC_UI_LANG` 选，默认 en。组件改成 `t.xxx`。中文版保留给中文用户和以后的 Qloo/PayPal 投递。多花约 1 小时，**合计约 5 小时**。测试可以固定 zh 来少改断言，也可以改成断言 en。

还要顺手处理：
- `ASSISTANT_NAME` 改成 "Alexa+"；
- `STATUS_LABEL` 改成 Scheduled / Live / Ended；
- 主页左栏那个"会"字 logo 换成 "T2B"；
- SVG 字体栈加 Inter/Arial；
- 重新 `next build`（dev server 还有 node:crypto instrumentation 崩溃，继续用生产构建录）。

## 4. 方案 A 的总工期估算

| 项 | 时间 |
|---|---|
| 英文 UI（字典方案） | 5h |
| incident 文案改成 Cyber Monday，验证回滚插入 | 2h |
| `工作` 页签加 incident 汇总卡（可选） | 1h |
| SVG 预览（可选，给彩蛋镜头用） | 1h |
| 新 record.mjs：直接发 utterance、切页签、关菜单 | 1.5h |
| narration v2 加 Kokoro TTS，**这次要真听一遍** | 1h |
| render.py v2：局部放大、字幕、计数器 | 2.5h |
| 质检：抽帧、响度、人工试听 | 1h |
| **合计** | **约 13–15 小时**，按 2 天排，10/22 晚前出 v2，留 1 天缓冲给 10/24 03:00 |
