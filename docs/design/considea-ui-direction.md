# considea — UI 设计提案

日期：2026-10-04，修订 2。阶段：完整设计提案与可操作视觉原型。原型使用示例数据，尚未接入真实团队和 Agent 工作流。

## 已确认方向与目标

用户确认：保留黑银流体首页，将同一套流体形态延续进工作台；整体需要更大胆、更艺术，并保护文字阅读。浅色、深色作为同等完整的模式提供；项目默认全英文，同时提供中文界面。保留候选与成员想法的关联交互。

产品面向 Hackathon 小团队：分别理解成员，确认可共享的偏好，组织关键分歧讨论，形成候选并验证，最终由成员选择方向。设计成功意味着：首次进入能知道下一步做什么；能够理解每个方向从何而来；私人访谈、已共享信息、AI 推断和人工决定始终可区分；长时间讨论与阅读依然舒适。

功能参考：用户提供的 Claude 原型 https://claude.ai/artifact/7nSYYv9ApYdxAc4ghTQRdf ，包含创建与加入、私人访谈、可编辑共享摘要、想法来源、三个候选、候选详情、成员态度及 Agent 工作进度。项目 README / workflow 为流程约束补充。

当前原型的候选迭代轮数与项目说明中的讨论轮数含义不同。本次设计不改变流程规则：用户界面明确标出「Interview question」「Discussion round」「Candidate version」，不复用无说明的 02/07 或 01/03。具体数字从实际工作流状态读取。

原型默认使用英文，面向 Hackathon 演示；设计说明使用中文。所有导航、控件、辅助信息、状态、弹窗与可控示例文案提供中文。成员真实输入保留原文，界面语言切换不自动翻译、修改或重新共享成员内容。

## 视觉依据与独特性

- awesome-design-md / Runway：全幅黑色视觉、背景作为主要品牌记忆、让界面退后、控制装饰。
- awesome-design-md / Linear：表面层级、精确间距、清楚的选中状态和工作界面的纪律；不照搬它的紫色主按钮。
- awesome-design-md / Apple：阅读清晰度与稳定控件；不采用上一版常规侧栏和白色卡片墙。
- ui-ux-pro-max：可读性、触控与键盘、渐进呈现、反馈和移动端重排。

本产品的识别来自「流动的想法逐渐成为可追溯的共同方向」。黑色流体与浅色珍珠银使用相同几何形态，大幅衬线标题与银色反射形成品牌连续性。每个成员有稳定身份色，颜色只标记贡献来源。阅读内容集中在一张稳定、不透明的工作桌，其他留白区可有低速流体运动。上一版静态 PNG 保留为历史提案，以本原型为当前视觉依据。

## 全局设计系统

### 明暗主题

| 语义 | 浅色模式 | 深色模式 |
| --- | --- | --- |
| canvas | #E9EAE7 | #08090B |
| surface | #F8F9F7 | #131518 |
| surface-secondary | #E9ECE8 | #1C2025 |
| text-primary | #252A2C | #F2F1EE |
| text-secondary | #596263 | #ADB3BD |
| divider | #D1D6D3 | #343A42 |
| control-border | #737E7F | #929BA7 |
| primary-action | #252A2C | #EFEFEB |
| on-primary | #FBFBF9 | #14171B |
| focus | #315E9F | #A6C7F8 |

divider 只用于非交互分隔；输入边界、未填充按钮轮廓与键盘焦点使用更明显的 control-border / focus。主题是统一映射，页面不可独立写死底色。更换主题时保留布局、选择、历史和关系。

成员色采用四种低饱和身份：iris #7064A5、sea #39796B、clay #A36350、ochre #8B6B2E。浅色内容块仍使用深色正文，身份色作为小圆点或细侧标记。深色主题分别调整为 #B9B1EB、#96CABF、#E5B7A9、#DFC892。身份颜色不用于表示赞成或反对。

### 字体与排版

- 英文展示字体 Instrument Serif 400：首页主标题、访谈当前问题、选中候选名称、最终方案标题。其余使用 DM Sans 400 / 500 / 600。
- 中文标题使用 Noto Serif SC，中文正文使用系统中文 sans-serif。英文展示字体缺失时 Georgia，操作字体缺失时系统 sans-serif。新原型实际加载 Instrument Serif 与 DM Sans，旧 PNG 使用本机替代字体。
- 首页标题桌面 104px / 1.02，平板 76px，手机 52px；最长 11 个英文单词，允许自然换行。
- 工作台入口大标题最高 94px / 0.91；选中方向展示标题最高 67px / 0.98；当前访谈问题 52px / 1.03。手机分别 56 / 56 / 39px，中文标题单独适配，不按英文长度压缩。
- 正文 14–16px / 1.55–1.65，辅助信息 12–13px，11px 仅桌面紧凑身份／状态标签；移动端关键文字恢复 13–16px。正文与标签使用正常字距；大英文标题可用轻微负字距。
- 正文段落宽度控制在约 60–75 个英文字符；中文约 28–38 字。

### 间距、表面和控件

- 间距：4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96。
- 桌面外边距 40px，平板 24px，手机 20px；正文最大宽度 1440px，访谈主阅读区 720px。
- 顶栏高约 104px。移除常驻侧栏，改为顶部三项导航。按钮与输入圆角 10px，整体工作桌 22px，小标签 6px，头像圆形。明暗与语言切换使用小型分段控件。
- 主按钮高 44px，正文 14px / 500，横向内边距 18px。一个任务区只保留一个视觉主按钮。
- 输入高至少 48px，标签常驻；多行输入初始高 120px，可扩展。成员回答不被截断。
- 工作台深度来自一张整体工作桌、表面与间距；只有工作桌与浮层使用阴影。来源项、候选正文和态度区不各自包成独立卡片。
- 图标采用统一 Lucide outline，18px / 1.5px 描边，动作图标有文字或可访问名称。

## 页面与导航

| 页面 | 主要任务 | 主动作 |
| --- | --- | --- |
| Landing | 理解产品并开始 | Start a session |
| Session setup / join | 创建团队空间或加入 | Create session / Join session |
| Room lobby | 邀请成员、准备个人输入 | Start my interview |
| Private interview | 表达自己的想法 | Send answer |
| Summary review | 确认共享内容 | Share this summary |
| Team studio | 解决当前分歧、理解方向来源 | 随阶段显示回应问题或记录态度 |
| Candidate detail / comparison | 修改、比较和验证候选 | Save new version / Confirm my choice |
| Project brief | 带着讨论成果开始构建 | Export brief |

这些是任务视图，不必都成为独立顶层导航。顶部只显示 Your perspective、Team studio、Project brief。候选、来源、历史属于 Team studio；资料确认属于 Your perspective。当前阶段显示于工作桌顶边，用户可返回查看已完成阶段，但不能绕过尚未满足的共享或决策条件。

## 首页：黑银流体

保留用户附件的黑银动态视觉为主角。Logo 统一小写 considea，左上 32px；右上只留 How it works、See a session。首屏文字居中，主标题继续使用 What should we build?，避免为了重设计而丢掉已经清楚的品牌问句。

副文案：Different perspectives. A direction you choose together.

主按钮 Start a session，白色填充；次按钮 Join a session，透明底、可见轮廓。See a session 打开明确标注 Example session 的可重置演示，不与真实房间混用。左下短句 Different perspectives. A shared direction. 右下 Pause motion，提供实际暂停与恢复。

背景中央留暗区，禁止亮斑频繁穿过标题。首页首屏默认不堆创建表单。下方用一个真实示例说明私人输入、确认共享、讨论方向的过程，配一次来源关联预览；随后给出最终 brief 的具体内容和末尾 Start a session。

### 从黑色入口到浅色工作室

点击 Start a session 进入专用设置页。Logo 保持同一大小与位置，黑色背景在约 400ms 内淡出到珍珠白，内容进入但立即可操作。禁止闪白、粒子飞散或必须等待的片头。开启 reduced motion 时直接切换。

## 创建、加入与房间

创建页左侧占约 40%，简短标题 A place to think together. 和 3 条具体说明；右侧宽 520px 的单列表单。第一屏只问 Session name、Your name、Time available；Competition link、Hard constraints、讨论上限、外部检索选项放在可展开 More context。上限与权限保存真实值，不能由界面装饰性推断。

成员颜色在输入名字后自动分配，在身份小圆点菜单中可更换；冲突颜色不可重复选择。颜色说明不用占据独立大区块。

加入页提供 Room code 与 Your name 两项；房间链接自动带入 code，加入前显示房间名。错误在对应字段旁显示，例如 This session code was not found. Check the code and try again. 已加入用户恢复自己的身份，避免重建第五个成员。

创建完成直接进入 lobby：房间标题、真实已加入成员、复制邀请链接、Start my interview。成员区显示 Invited、Joined、Interviewing、Summary shared；不得把在线状态等同于完成访谈。等待时可以开始自己的访谈，不能编辑其他成员的身份或确认。

## 私人访谈：专注表达

桌面主区 720px，右侧 320px 摘要区。初始摘要区为空时折叠，主区显示一个当前问题，历史回答放在上方可回看；不把三个长问题同时变成三份表单。问题可以保留有助理解的追问说明，但每次只有一个主输入。

顶部固定短标签 Private to you。标签可展开说明原始回答不会自动进入团队空间。当前问题示例 What keeps going wrong when your team works together?，下面浅色段落式回答，不将每条内容都包成聊天气泡。

底部输入有固定标签 Your answer；Enter 换行，Ctrl/Cmd + Enter 发送。Sending… 只锁当前发送动作，已输入内容保留。历史回答可查看与编辑；编辑影响摘要时明确显示 Summary needs review。

摘要出现后显示 We understood this. 分类为 Problem、Interests、Contribution、Concerns、Flexibility。每条提供 Edit 和 Remove，AI inferred 与 From your answer 使用不同文字标记，附本人回答引用。生成中的文字没有批准状态。

访谈完成后显示完整 Summary review。主按钮 Share this summary，附近明示 Only the items shown here will be shared. 点击后才进入公共上下文，按钮确认状态显示 Summary shared。允许后来修改，但修改后需重新确认；显示谁能看到与当前共享版本。

## Team studio：核心布局

宽屏使用工作桌内的三段：左侧来源约 252–285px，中央可伸缩，右侧成员状态约 260–285px；列间留 52–62px 展示来源关系。没有全局侧栏。1000px 以下状态区移到下方，640px 以下候选优先、来源和态度纵向排列，不压缩正文。工作桌外部留白承载流体，内部使用完全不透明底色。

主标题随阶段改变：What matters most?（讨论）、Choose a direction together.（候选）、Ready to build?（确认）。顶部显示房间、实际阶段、真实已共享人数，主要动作与阶段相符。搜索、复杂工具栏、无限画布操作不进入首版。

### 讨论阶段

中央显示 AI 找出的一个当前关键分歧，而不是直接给候选评分。结构：问题 → 为什么影响方向 → 已批准共享的不同立场 → 本人的回应。AI 的解释允许成员提出异议。题目可能是选择或开放回答，控件根据实际题型显示。

回应提交后显示 Your response is recorded，并显示等待哪些成员；沉默不计入同意。上一轮结果保留在 History。下一轮私人追问通过 Your perspective 的提示进入，不公开未批准的回答。

### 候选阶段

中央顶部使用三个文字切换项与细选中线，避免重复候选卡片。更多候选通过 Show all 进入列表；候选区别用真实取舍描述，不使用虚构分数或百分比。初始按团队当前选择进入；无选择时显示全部候选概览。AI 建议可标为 Suggested by considea，并附可展开依据，不能成为人类确认。

选中候选中央直接排在工作桌上，使用大幅衬线名称、目标用户、实际问题、核心机制、最小 demo、关键取舍。仅关键取舍使用轻微表面色差。下方逐项展开 Team fit、Feasibility、Similar projects、Sources；所有信息并非首屏同时铺满。

左侧 The starting points：按人分组的已共享来源项，每项含名字、类别、具体内容。默认四人来源都可读；选中候选后相关项显示身份侧标记与连接，非相关项回到正常次级文字，不能变成无法阅读的灰字。来源较多时提供 Show all perspectives。

右侧是 Where everyone stands：真实成员逐行显示态度、附带条件、针对的方案版本与更新时间。自己的操作可以编辑，其他人的行只读。

## 标志性交互：方向如何长出来

点击候选或聚焦后选择，显示它与左侧共享想法的关系。最多同时突出 4–6 个关键来源，其他内容在 Show all sources 中查看，避免线条交叉成团。

- From a member：实线，说明明确使用了某人的已批准想法。
- Combined by considea：虚线，说明组合关系由 AI 提出；起点内容仍必须已获准共享。
- Constraint：在线旁显示 Constraint 标签，说明该顾虑是方案需要满足的条件，而非支持票。

连接路径是视觉补充，实际详情同时列出来源和解释。点击某个来源反向显示涉及的候选，并在中央展示 Why this is connected。关系不能通过拖动节点修改，位置变化也不产生内容决定。

来源示例：Maya 的「散会没人知道谁答应了什么」+ Leo 的转写接口 → Meeting clarity；Noah 的实时延迟顾虑 → 先做会后整理。关系不是「贡献多就必然最好」。AI 推断和真实承诺都用文字说明。

## 候选比较、修改和共识

Compare directions 进入 2–3 列比较，比较字段固定为 User、Problem、Demo、Team fit、Main trade-off、Evidence、Open questions。手机一次显示一个维度下的候选，避免横向滚动宽表格。比较可以返回原选择与滚动位置。

修改候选通过 Edit direction 抽屉，字段为标题、用户、核心体验、MVP、取舍及说明。保存前显示修改摘要，Save new version 生成新版本。旧确认留在历史，不继承到新版；现有态度显示 Needs reconfirmation。此行为用于清晰说明版本后果，不靠短暂 toast 表达。

我的态度四个固定选项：Ready to build / Yes, if… / Not this direction / Still thinking。Yes, if… 展开条件输入。原型中文映射：愿意推进／满足条件后愿意／不愿推进／暂未决定。

状态显示 2 of 4 ready，不叫 50% consensus；没有回复显示 Awaiting response。条件支持旁边持续显示条件，不能计入无条件确认。所有成员确认同一版本后显示 Everyone confirmed this version；如果规则不满足，只能生成带未决项的讨论成果，不能写成共识。

结束讨论是次级入口 Save discussion outcome，打开成果预览，显示成员真实状态与未决问题。达到轮数上限同样保留分歧。开始构建由符合实际规则的 Confirm direction 流程完成。

## Agent 进度与证据

首屏仅一行当前真实工作：Checking whether the transcription API needs approval. 可点击 Activity 展开时间顺序日志。后台 agent 名称与任务细节默认放在详情，面向成员的主文案描述正在做什么、为什么、等待谁。

不显示编造百分比、思考倒计时或没有来源的 confidence score。等待人时明确 Waiting for Leo to confirm API latency。失败显示任务范围、已保留的成果与 Retry；查询失败不能擦掉成员输入。

证据标签统一为 Verified、Source-backed、Team-reported、Needs testing、Unknown；每项有简短解释和来源。检索部分完成显示 Some checks are still open，可以阅读已完成部分。外部链接来源可打开，不能把来源数量当作可行性结论。

## 最终 Project brief

采用有阅读节奏的单列文档，最大宽 880px：方案名 → 一句话机制 → 为谁解决什么 → MVP → 为什么适合团队 → 成员明确承诺 → 已做出的决定 → 证据与风险 → 未决问题 → 首个构建步骤。

成员承诺只从实际确认读取；AI 推荐的分工显示 Suggested ownership，不能写成某人已接单。顶部写明版本、确认状态与日期。完成标记只在真实状态满足时显示，不用烟花或强制庆祝。

主动作 Export brief；次动作 Copy summary 与 Back to studio。导出必须含来源、未知项、版本和未决分歧，方便带入后续开发。改方向产生新版本，旧记录保留。

## 动效

首页与工作台采用同一套持续低速流体。黑色为石墨银反射，浅色为珍珠银反射。原型使用低分辨率程序材质，约 24fps 更新，形态变化按慢速时间推进；不响应鼠标追逐。

动效阅读保护：正文工作桌完全不透明；大标题区域设置方向性稳定遮罩；成员说明使用高不透明度底面。主要亮斑留在空白、边缘和页面背景，阅读区内禁止流体、闪光或折射覆盖文字。主题切换只改变材质与颜色，成员输入、选择和条件都保留。

提供 Pause motion / Resume motion；页面隐藏时停止绘制；系统 prefers-reduced-motion 开启时只显示静态材质并说明状态。WebGL 不可用时使用主题底色，正文功能继续运行。Focus on the discussion 收起大标题、降低背景强度，把工作桌移到顶部；同一按钮可恢复氛围视图。动效不可成为完成任务的前提。

按钮反馈 120ms，选择／来源高亮 180–220ms，抽屉进入 260ms、离开 180ms，页面过渡 360–420ms。候选切换以关系切换为主，正文不长距离飞入。快速连续选择必须取消旧动画，显示最后一次选择。动效不延迟点击、阻止输入或宣布假进度。

## 响应式与键盘

- >1000px：来源、中央方向、成员状态三段；1230px 以下缩减列间距，但保持正文尺寸。
- 641–1000px：来源与方向两段，成员状态移到下方。顶部导航换行。
- <=640px：当前问题／候选在首位，来源与态度在下方，连线隐藏但来源文字完整保留。顶部导航换行，模式和语言均可访问。输入和动作不被软键盘遮挡。
- 375px 宽与 200% 缩放均不产生整页横向滚动。正文不缩小以勉强塞入三栏。
- 用 Tab 访问动作，候选切换用方向键，Enter 选择，Esc 关闭抽屉并回到触发控件。连接不要求鼠标悬停或拖拽。
- 普通文本对比 >=4.5:1，必要控件边界／状态 >=3:1；键盘焦点明显且不被固定层挡住。移动端关键动作目标至少 44×44 CSS px。

## 关键状态

| 情况 | 文案与操作 |
| --- | --- |
| 没有队友加入 | Invite your team；复制链接，可先开始自己的访谈 |
| 摘要未共享 | Your summary is still private；Review and share |
| 部分成员未完成 | 真实人数与名单；已经完成的人可以查看自己获准看到的内容 |
| 正在生成方向 | Creating directions from the shared perspectives；保留来源内容，不假造完成条 |
| 当前没有高影响分歧 | 当前已共享观点说明；按真实流程继续，不能随意制造争议 |
| 搜索失败／部分完成 | Some checks could not be completed；展示已完成证据，Retry checks |
| 网络断开 | Connection interrupted. Your draft is kept here.；只在本地确实保留后使用这句话 |
| 提交失败 | Could not save your response. Try again.；保留输入，避免双提交 |
| 新版等待确认 | Direction updated. Please review your stance again.；对照旧版查看变化 |
| 达到上限且有分歧 | Discussion saved with open questions；输出真实未决项 |
| 无关联来源 | No approved perspective is linked yet；不补造线条 |
| 外部搜索关闭 | External checks are off for this session；标明未核实原因 |

## 创意优先级

首版保留三项：候选来源显现；条件支持持续可见；可导出的「为什么是这个方向」决策记录。

可选增强：仅展示已批准共享内容的 session replay，让演示观众看到讨论如何改变候选；最终 brief 中的 Decision trail 展示真实决定与版本。没有完整历史数据时不生成回放。

不在首版引入：自由拖动的无限画布、虚构共识百分比、头像围圈自动融合成一致意见、未绑定流程的计时器、装饰性 agent 面板、强制语音输入。

## 验收与下一步

1. 视觉对照用户黑银背景、来源关系交互与本稿浅色工作室，不回退到彩色便签墙。
2. 首页清楚指向创建／加入；已在房间的人回到自己的实际阶段。
3. 走通四人真实访谈、修改共享摘要、公共来源、关键分歧回应、候选与版本确认。
4. 未共享内容不出现于公共来源、连接图、activity 或导出。
5. 单个成员无法代替其他人表态；未回应与条件支持不计为无条件确认。
6. 来源多、长标题、四人态度不一致、检索失败、网络失败及版本变更都有清楚呈现。
7. 键盘、375px、768px、1024px、1440px、200% 缩放和 reduced motion 均可完成核心动作。
8. 当前可操作原型为 considea-atmosphere.html。可检查两种主题、中英切换、动效暂停、专注模式、候选与来源、本人态度、比较／证据弹窗、私人草稿和示例简报导出。此原型不连接真实房间、访谈模型或 Agent；真实工作流工程实现仍需在此设计基础上接入。

## 中英双语规则

| 英文默认 | 中文界面 | 含义 |
| --- | --- | --- |
| Your perspective | 我的想法 | 本人的访谈与共享确认 |
| Team studio | 团队工作室 | 公共讨论、候选与真实态度 |
| Project brief | 项目简报 | 保存的方向、决定与未决项 |
| The starting points | 想法从这里开始 | 已批准的成员来源 |
| The smallest useful demo | 最小的可用演示 | 能实际演示的最小范围 |
| A trade-off worth discussing | 一个值得讨论的取舍 | 候选承担的代价 |
| Ready to build | 愿意推进 | 对当前版本的无条件支持 |
| Yes, if… | 满足条件后愿意 | 支持条件必须持续保留 |
| Still thinking | 暂未决定 | 不计入同意 |
| Focus on the discussion | 专注讨论 | 收起氛围头图，降低背景强度 |
| Show the atmosphere | 展开氛围背景 | 恢复大标题与背景表现 |

界面词典按稳定语义键组织，英文是内容基准。切换语言时不重置候选、主题、输入、态度和条件；按钮、可访问名称、弹窗标题、反馈、表格列头和导出均使用对应语言。房间名、姓名、技术名与成员真实内容不自动翻译。示例种子内容有双语版本，不能推断真实成员内容同样已被翻译。若之后增加译文功能，必须标注 Translation 并保留原文。

日期与数字使用当前界面 locale，复数使用完整句式，不拼接英文碎片。中文标题单独使用中文字体与字号，保持自然换行。主题与语言作为个人偏好保存，不改变同房间队友的显示设置。草稿仅在本地存储成功时提示已保存。
