# DM Response Pipeline — 完整技术文档

> 面试准备 + 架构参考文档

## 一、总体架构

本系统是一个 **LLM-Based TTRPG (桌面角色扮演游戏) 自动DM系统**。核心是一条 **20节点多智能体流水线（Multi-Agent Pipeline）**，每次玩家发送消息后，流水线完成从意图分析到叙事生成再到状态持久化的完整闭环。

### 技术栈
- **前端**：Next.js 15 (App Router) + React 19 + Tailwind CSS + shadcn/ui (Radix)
- **后端 API**：Next.js Route Handlers (SSE streaming)
- **LLM**：OpenAI GPT-4.1（叙事生成 + Function Calling 工具调用）
- **数据库**：Supabase (PostgreSQL + pgvector 向量检索)
- **向量嵌入**：OpenAI text-embedding-3-small (1536维)
- **实时通信**：SSE (Server-Sent Events) 流式输出
- **可观测性**：LangSmith（可选，OpenAI SDK wrapper 追踪）
- **表单/校验**：React Hook Form + Zod
- **动画**：Framer Motion
- **流程可视化**：ReactFlow / XYFlow（Story Graph 编辑器）

### 框架说明
本项目 **不使用 LangChain 框架**。整条 Multi-Agent Pipeline 是基于 OpenAI SDK (`openai` npm包) 直接构建的自定义流水线。每个 Node 是一个独立的 TypeScript 函数，通过 `workflow.ts` 手动编排执行顺序和并行/串行关系。

可选集成了 **LangSmith** (`langsmith` npm包) 用于 API 调用追踪，通过 `wrapOpenAI()` 包装 OpenAI 客户端实现，需要设置 `LANGCHAIN_TRACING_V2=true` 环境变量激活，不影响核心逻辑。

### 架构图

```
玩家消息 ──→ [API Route] ──→ executeDMResponseWorkflow()
                              │
                              ▼
═══════════════════ 阶段1: 输入 + 意图 ═══════════════════
                    [Node 1] 输入验证（sessionId/message 非空）
                              ▼
                    [Node 2A + 2B] ── Promise.all ──
                    │ 2A: 数据检索（世界/玩家/历史/实体） │
                    │ 2B: LLM意图分类（7种意图）         │
                    ─────────────────────────────────────
                              ▼
                    [META短路] intent=META → 模板响应，return跳过全部Pipeline
                              │ (非META继续 ↓)
═══════════════════ 阶段2: 上下文检索 ═══════════════════
                              ▼
                    [Node 3B] 玩家状态加载（先执行，后续依赖其属性值）
                              ▼
                    [preInCombat] session_npc_stats.in_combat 轻量查询
                              ▼
                    [Node 3A+3C+3D+3E+3F] ── Promise.all ──
                    │ 3A: 意图感知RAG（pgvector）          │
                    │ 3C: 场景事件生成（LLM，是否roll+DC）  │
                    │ 3D: 里程碑加载（最近5条）             │
                    │ 3E: 故事状态加载（活跃/可用节点）      │
                    │ 3F: NPC记忆加载                      │
                    ─────────────────────────────────────────
                              ▼
═══════════════════ 阶段3: 预处理 + 门控（experience-based的门控机制） ═══════════════════
                    [位置系统] 加载+自动初始化 → 3-pass正则 → LLM权威确认
                              ▼
                    [Node 0] 行动有效性门控（物品可达性+锁定检查）
                              │ blocked → return 短路
                              ▼
                    [模糊目标拦截] "敌人""怪物"等模糊词（排除NPC名白名单）
                              │ matched → return 短路
                              ▼
                    [地点物品加载] 当前位置可获取物品（排除已拥有+未解锁）
                              ▼
                    [战斗装备检测] 战斗中装卸装备 → 视为浪费回合（triggered=false）
                              ▼
                    [战斗安全网] preInCombat + COMBAT/SPELL_CAST → 强制triggered
                              ▼
                    [重试惩罚] 同地点同骰子类型连续失败 → DC+2/次，3次→return锁定
                              ▼
                    [DC覆盖] NPC dc_thresholds + acquisition_dc → 覆盖LLM DC
                              ▼
═══════════════════ 阶段4: 机械判定 ═══════════════════
                    [Node 4] 前置条件校验（5个micro-agent并行：3纯函数+2异步DB）
                              ▼
                    [Node 5] 骰子引擎（d12 + 自定义属性修正，纯函数）
                              ▼
                    [装备/NPC预处理] ── 所有意图均执行 ──
                    │ 玩家装备ATK/DEF汇总                           │
                    │ NPC目标解析（4级回退：指名→hostile→RAG→DB）    │
                    │ NPC装备加载（atk_bonus/def_bonus）            │
                    │ NPC技能加载（npc_abilities + abilities表）    │
                    │ NPC当前HP/MP（session_npc_stats）             │
                    ─────────────────────────────────────────────────
                              ▼
                    [战斗状态检测] 3路径：
                      Path 1: DB in_combat=true（持续战斗）
                      Path 2: hostile NPC + 玩家指名 + 攻击意图（首次遭遇）
                      Path 3: 非敌对NPC + 连续3次攻击（激怒开战）
                              ▼
                    [Node 6C] NPC战斗策略Agent（LLM，战斗时触发，失败→纯函数回退）
                              ▼
                    [技能/物品查找] SPELL_CAST→ability_damage/mp_cost
                                   ITEM_USE→item_stats(hp_restore/mp_restore)
                              ▼
                    [MP前置检查] SPELL_CAST: MP < mp_cost → 阻止施法
                              ▼
                    [Node 6] 结果合成器（纯函数，无LLM，确定性规则引擎）
                              ▼
                    [Node 6B] NPC行动代理（LLM，一次调用处理所有NPC）
                              ▼
═══════════════════ 阶段5: 叙事生成 ═══════════════════
                    [死亡预检测] 玩家HP/NPC HP投影 → 注入结局台本
                              ▼
                    [战斗掉落查询] NPC即将死亡 → 查询droppable装备
                              ▼
                    [Node 7] 上下文组装（合并所有数据+NPC技能列表+掉落物品）
                              ▼
                    [Node 8] Prompt构造（注入结局指令 + 战斗模式指令）
                              ▼
                    [Node 9] 流式叙事生成 ──→ SSE ──→ 前端
                              ▼
                    [战斗摘要] 程序化生成双栏战况，SSE meta事件
                              ▼
                    [死亡/结局检测] game_over / game_complete → SSE
                              ▼
═══════════════════ 阶段6: 状态持久化 ═══════════════════
                    [Node 10] 输出持久化（session_messages）
                              │
                    ┌─────────┴─────────── Awaited（SSE进度事件）
                    ▼
              Phase 1（并行，Promise.all）:
                [11] HP/MP更新    [12] 背包更新      [13] 状态效果
                [14] 事件日志    [15] 属性增长      [16] 里程碑检测
                [17] 故事节点完成  [18] NPC记忆更新
                [技能授予] learningAbility成功→入库
                [死亡结局] HP≤0 → 激活ending_bad节点
              Phase 1.5:
                [combat_info二次发送] 更新后的NPC HP/MP + npcAction
                [combat_victory检测] NPC HP≤0 → victory → combat_end
              Phase 2:
                [7] 动态字段更新（等Node 11完成，避免竞态）→ 同步HP/MP到core_stats
              Phase 3:
                [19] 叙事状态同步（LLM分析DM文本→物品入库，严格目录验证）
              Phase 4:
                [19B] 装备管理器（LLM解析装卸指令 → 确定性DB执行）
```

---

## 二、各节点详解

### Node 1: Input Validation（输入验证）
- **类型**：纯函数
- **功能**：验证 sessionId 和 playerMessage 非空
- **失败处理**：抛出错误，立即终止流水线

### Node 2A: Data Retrieval（基础数据检索）
- **类型**：数据库查询
- **功能**：从数据库加载当前 session 的基础数据
- **加载内容**：
  - `sessions` → 获取 world_id
  - `worlds` → 世界设定、背景、语气
  - `players` → 玩家基本信息、动态字段
  - `session_messages` → 最近10条对话历史
  - **基础实体**（NPC/物品/地点/能力/组织/分类/规则）→ 通过世界ID获取，作为RAG的后备
- **注意**：此节点 **不加载** 里程碑事件，里程碑由 Node 3D 专门加载

### Node 2B: Intent Classifier（意图分类器）
- **类型**：LLM工具调用
- **模型**：MODEL_FAST (gpt-4.1)
- **功能**：将玩家消息分类为7种意图之一
- **100% LLM分类**：所有正则模式匹配已移除，分类完全依赖 `classify_intent` 工具调用（tool_choice强制调用）。唯一的字符串检查是内部系统标记（`__GAME_START__`、`__META:*` 前缀）
- **关键分类规则**：
  - SPELL_CAST vs COMBAT：使用法术/技能名 → SPELL_CAST，使用武器/徒手 → COMBAT
  - ITEM_USE vs COMBAT：使用物品发动攻击 → COMBAT（不是ITEM_USE）
  - targetEntity = 主要目标（攻击时为NPC名，物品使用时为物品名）
  - SOCIAL + 学习/教授关键词：mentionedEntities 同时包含NPC名和技能名（如"请老头教我火球术" → entities=["老头","火球术"]）
- **批量操作检测**：识别"拾取所有"、"装备全部"等批量模式，设置 `isBatchAction=true`
- **调用工具**：`classify_intent`（OpenAI Function Calling），返回结构化的 intent + confidence + mentionedEntities + targetEntity + isBatchAction
- **输出**：IntentClassification（意图类型 + 置信度 + 提及实体 + 目标实体 + 批量标记）

#### 7种意图类型

| 意图 | 描述 | 典型触发词 | 是否触发骰子 |
|------|------|-----------|------------|
| `COMBAT` | 攻击、战斗、防御 | 攻击、战斗、打、fight | 是（战斗骰） |
| `SPELL_CAST` | 施法、使用魔法能力 | 施法、释放、cast spell | 是（才智骰） |
| `ITEM_USE` | 使用/消耗/激活物品 | 使用、喝下、打开 | 视情况 |
| `EXPLORE` | 探索、搜索、移动、检查 | 搜索、查看、走向 | 视情况 |
| `SOCIAL` | 与NPC对话、说服、欺骗 | 说服、威胁、询问 | 是（游说骰） |
| `NARRATIVE` | 询问世界/传说、角色扮演 | 这里是哪、发生了什么 | 否 |
| `META` | 规则问题、游戏外提问 | 规则是什么、怎么操作 | 否 |

**骰子触发判断**：意图分类器本身不决定是否roll骰子。这由 Node 3C（场景事件生成器）根据上下文综合判断。一般来说：
- COMBAT、SPELL_CAST、SOCIAL → 大概率触发骰子
- EXPLORE → 有危险时触发
- ITEM_USE → 复杂使用时触发
- NARRATIVE、META → 不触发

### Node 3A: Intent-Aware RAG（意图感知检索）
- **类型**：向量相似度检索（pgvector）
- **功能**：根据玩家消息 + 意图类型，从世界数据库中检索最相关的实体
- **检索策略**：
  - 生成玩家消息的向量嵌入
  - 根据意图类型决定检索哪些表（COMBAT优先检索NPC，ITEM_USE优先检索物品等）
  - 使用 `match_npcs`、`match_items` 等 RPC 函数进行余弦相似度匹配
  - 相似度阈值按意图不同：COMBAT/EXPLORE=0.45, SPELL_CAST/ITEM_USE/SOCIAL/NARRATIVE=0.50, META=0.60
- **返回**：意图相关的 NPC（含 combat_stats）、物品（含 item_stats）、地点、能力等
- **回退**：检索失败时使用 Node 2A 的基础实体数据

### Node 3B: Player State Loader（玩家状态加载器）
- **类型**：数据库查询
- **功能**：加载完整的玩家游戏状态
- **位置**：在3A/3C之前执行，因为其他并行节点依赖玩家属性值
- **加载表**：
  - `player_core_stats` → HP、MP、ATK（基础攻击力，默认2）、DEF（基础防御力，默认0）
  - `player_inventory` → 背包物品（含数量、装备状态、9种装备槽位）
  - `player_spell_slots` → 法术位（类型保留，机制暂未启用）
  - `player_status_effects` → **状态效果（buff/debuff）**，含duration、effect_type、source_name
  - `player_custom_attributes` → 五维自定义属性（战斗/游说/混沌/魅力/才智），影响骰子修正
- **装备槽位**（9种）：weapon_1、weapon_2、armor_head、armor_chest、armor_legs、accessory_1-4
- **输出**：PlayerState 对象（含 attack、defense、inventory、spellSlots、statusEffects、customAttributes）

### Node 3C: Scenario Event Generator（场景事件生成器）
- **类型**：LLM工具调用
- **模型**：MODEL_FAST (gpt-4.1)
- **功能**：决定是否触发骰子检定，以及用哪个维度的骰子、DC值多少
- **inCombat 感知**：接收 `inCombat` 参数。当 `inCombat=true` 时，system prompt 注入强制指令：`"⚠️ ACTIVE COMBAT: You MUST set triggered=true"`，防止 LLM 在战斗中返回 `triggered=false`
- **5种骰子维度**：
  1. **COMBAT（战斗）**：物理战斗、近/远程武器攻击、防御、杂技闪避
  2. **PERSUASION（游说）**：社交、谈判、欺骗、威吓
  3. **CHAOS（混沌）**：不可预测、冒险的行为、冲动、不道德行为
  4. **CHARM（魅力）**：诱惑、调情、亲密/浪漫互动、吸引他人、个人磁场
  5. **WIT（才智）**：施法/魔法、谜题、策略、推理、研究、智取
- **施法归类**：施法/魔法能力 → 几乎总是 WIT（除非是混沌/狂野法术 → CHAOS）
- **DC计算**：
  - 基础DC范围：4（极易）到 11（极难），基于d12系统
  - **自适应DC上限**：`Math.min(50, 11 + Math.floor(attr/5) * 2)`
    - 玩家每5点属性值，DC上限增加2
    - 例：玩家属性值30时，DC上限 = 11 + 6*2 = 23
  - 每点属性值给骰子+1修正，所以高属性玩家仍能挑战高DC
- **不触发骰子的情况**：纯叙事、移动、观察、拾取物品、使用/装备已拥有物品、与非魔法日常物体的简单交互
- **必须触发的情况**：战斗、施法、说服/欺骗NPC、激活魔法祭坛/仪式物品/关键故事机关、敌对NPC出现
- **战斗安全网**（workflow.ts）：在 Node 3C 之后，**仅当 intent=COMBAT/SPELL_CAST 时**，如果 `preInCombat && !effectiveScenarioEvent.triggered && isCombatIntent`，workflow 强制覆盖为 `{ triggered: true, diceType: 'COMBAT', dc: 6 }`。非战斗意图（EXPLORE/ITEM_USE/SOCIAL等）不强制触发，由 Node 3C 自行决定

### DC覆盖系统（workflow.ts）
- **类型**：纯函数（数据库读取 + 数值计算）
- **位置**：Node 3C 之后、Node 4 之前
- **功能**：使用世界设计者定义的DC阈值覆盖LLM生成的DC值
- **三层DC来源**：
  1. **NPC dc_thresholds**：`combat_stats.dc_thresholds.{combat|persuasion|chaos|charm|wit}`（与骰子维度对应）
  2. **Ability acquisition_dc**：`ability_stats.acquisition_dc`（说服NPC学习技能的额外DC，叠加到NPC阈值上）
  3. **Item acquisition_dc**：`item_stats.acquisition_dc`（说服NPC获取物品的额外DC）
- **null回退**：dc_thresholds 中 null 值表示回退到LLM判断（向后兼容）
- **与自适应DC的关系**：世界设计者显式设定的DC不受自适应DC上限限制。重试惩罚仍然叠加
- **示例**：NPC PERSUASION DC=9 + ability acquisition_dc=5 → 说服学技能总DC=14

### Node 4: Precondition Validator（前置条件校验）
- **类型**：混合（纯函数 + 异步数据库验证）
- **功能**：检查玩家是否满足执行当前行动的前置条件
- **5项检查**（并行执行，Promise.all）：
  1. **背包检查**：ITEM_USE → 背包中是否有该物品（严格名称匹配）
  2. **技能检查**：SPELL_CAST → 是否掌握该技能（slot_type='ability'的背包物品匹配）+ **世界目录交叉验证**（abilities表ilike确认技能存在于世界中）。返回spellInfo（attackBonus=2+wit, saveDC=8+wit）
  3. **武器/能力检查**：COMBAT → 查找weapon_1/weapon_2槽位的装备武器，返回weaponStats（attackBonus=playerState.attack）
  4. **场景一致性检查**（仅COMBAT意图）：玩家攻击目标是否存在于当前故事节点的 `interactive_hints` 列表中，**或**是否为 RAG/世界数据中已知的 NPC 名称（动态召唤的NPC不在 interactive_hints 中但仍可战斗）
  5. **技能学习验证**（Micro-Agent E，异步）：SOCIAL + 学习关键词 → 验证技能是否存在于世界目录（abilities表）+ NPC是否拥有该技能（npc_abilities表）+ NPC别名匹配（获取所有世界NPC的name+aliases做内存模糊匹配）。返回 `learningAbility: { abilityId, abilityName }`
- **异步化说明**：Micro-Agent B（技能检查）和E（学习验证）需要查询数据库，函数签名新增 `worldId` + `supabase` 参数。其余3个仍为纯函数
- **注意**：法术位消耗检查已移除（预留为世界模组扩展）。Debuff阻止行动是TODO项
- **输出**：canProceed (布尔) + 失败原因 + weaponStats + spellInfo + learningAbility

### Node 5: Dice Engine（骰子引擎）
- **类型**：纯函数（随机数生成）
- **功能**：执行d12骰子投掷 + 属性修正
- **计算方式**：
  - 基础骰：`1d12`（1-12随机）
  - 属性修正：对应维度的 customAttribute 值
  - 总值 = 骰面 + 属性修正
  - 自然1 = 大失败（Critical Failure）
  - 自然12 = 大成功（Critical Success）

### Node 6C: NPC Combat Strategy Agent（NPC战斗策略Agent）
- **类型**：LLM工具调用
- **模型**：MODEL_FAST (gpt-4.1)
- **触发条件**：当 `(intent=COMBAT || intent=SPELL_CAST || inCombat)` 且 NPC有可用技能时调用
- **功能**：使用LLM为NPC选择本回合的战斗行动（攻击技能、治疗技能、或普通攻击）
- **输入**：NPC名字/HP/MP/ATK/DEF/技能列表 + 玩家HP/ATK/DEF + 近期对话
- **调用工具**：`select_combat_action`（action_type + ability_name + reasoning）
- **输出**：chosenAbility（NpcAbilityForCombat | null）+ reasoning
- **回退**：LLM失败时→纯函数（HP<30%选治疗，否则选最高伤害技能）

### Node 6: Outcome Synthesizer（结果合成器）
- **类型**：纯函数（无LLM、无数据库）
- **功能**：将前置条件 + 骰子结果 + Node 6C选定技能 → 最终结果类型 + 机械效果
- **inCombat 参数**：接收 `inCombat?: boolean`。当 `inCombat=true` 时，即使 `diceType` 不是 COMBAT（如 WIT 施法），也进行战斗伤害计算
- **为什么无LLM**：这是一个确定性的规则引擎。骰子已经投了，DC已经确定了，结果就是数学比较：
  - `total >= DC + 4` → CRITICAL_SUCCESS
  - `total >= DC` → SUCCESS（对应属性+1）
  - `total >= DC - 2` → PARTIAL（勉强成功，有代价）
  - `total < DC - 2` → FAILURE
  - 自然1 → CRITICAL_FAILURE
  - 自然12 → CRITICAL_SUCCESS
- **机械效果生成**：
  - SPELL_CAST → SPELL_SLOT_USED（MP消耗）
  - ITEM_USE成功 → ITEM_CONSUMED
  - 属性成功 → ATTRIBUTE_GAIN（对应维度+1）
  - **战斗伤害计算**（`diceType === 'COMBAT' || inCombat` 时触发）：
    - **NPC→玩家（普通攻击/技能攻击）**：`damage = max(1, NPC_ATK - 玩家总DEF)`，其中NPC_ATK可来自选定技能damage或基础ATK
    - **NPC→玩家（吸血技能，hp_restore<0）**：`damage = |hp_restore|`（无视DEF，直接吸取HP）
    - **NPC治疗**：当Node 6C选择治疗技能（hp_restore>0, damage=0）时，NPC恢复HP而非攻击
    - 玩家→NPC（物理/COMBAT）：`damage = max(1, 玩家总ATK - NPC总DEF)`
    - 玩家→NPC（法术/SPELL_CAST）：`damage = max(1, ability_damage - NPC总DEF)`（独立于玩家ATK）
    - 玩家→NPC（攻击性物品/ITEM_USE无hp/mp_restore）：`damage = max(1, 玩家总ATK - NPC总DEF)`
    - **治疗物品不造成伤害**：ITEM_USE 且 item_stats 含 `hp_restore`/`mp_restore` 时，跳过玩家→NPC伤害
    - NPC→玩家伤害倍率：CRITICAL_FAILURE ×2, FAILURE ×1, PARTIAL ×0.5, **SUCCESS ×0.25（擦伤）**, CRITICAL_SUCCESS 0（完全闪避）
    - 玩家→NPC伤害倍率：PARTIAL ×0.5, SUCCESS ×1, CRITICAL_SUCCESS ×2
    - **NPC MP消耗**：通过 `NPC_MP_DELTA` 效果直接扣减，无论NPC是否命中（使用技能即消耗MP）
  - **PRECONDITION_FAILED + 战斗中**：玩家行动被前置条件阻止（如MP不足、无技能），NPC仍获得一次完整攻击机会（使用Node 6C选定的技能，含攻击/吸血/治疗三种）
  - **NPC免费攻击**（`inCombat && !scenarioEvent.triggered` 时触发）：玩家在战斗中做非攻击操作时，NPC 获得一次免费攻击机会（相当于FAILURE结果的伤害）
  - **ATK/DEF汇总**（在workflow.ts中计算）：
    - 玩家总ATK = player_core_stats.attack + Σ(装备weapon/accessory的atk_bonus)
    - 玩家总DEF = player_core_stats.defense + Σ(装备armor/accessory的def_bonus)
    - NPC总ATK = combat_stats.attack + Σ(npc_equipment weapon/accessory的atk_bonus)
    - NPC总DEF = combat_stats.defense + Σ(npc_equipment armor/accessory的def_bonus)

### Node 6B: NPC Action Agent（NPC行动代理）
- **类型**：LLM工具调用
- **模型**：MODEL_FAST (gpt-4.1)
- **功能**：为场景中所有相关NPC生成本轮行动
- **输入**：NPC资料（含记忆、态度）+ 玩家行动 + 骰子结果 + 故事状态
- **输出**：每个NPC的 action（行为描述）+ dialogue（对话）+ attitudeShift（态度变化）
- **设计决策**：一次LLM调用处理所有NPC（而非每个NPC单独调用），降低延迟

### Node 7/8: Context Assembly + Prompt Construction（上下文组装 + Prompt构造）
- **类型**：纯函数
- **功能**：将所有检索到的数据、骰子结果、NPC行动等拼接成最终的DM提示词
- **拼接顺序**：世界设定 → 物品 → 地点 → 能力 → 组织 → 分类 → 规则 → NPC → 玩家字段 → 玩家上下文 → 对话历史 → 里程碑 → 故事状态 → 场景事件 → 机械结果 → DM指南 → 结局指令（如有）
- **特殊指令**：
  - 有骰子结果时：注入"机械结果已确定，你只需叙述"指令
  - 检测到结局节点时：注入结局台本（ending_script），要求写3-5段终章

### Node 9: Streaming LLM Generation（流式叙事生成）
- **类型**：LLM流式输出
- **模型**：MODEL_NARRATIVE (gpt-4.1)
- **功能**：基于完整prompt生成DM叙事回应
- **输出**：通过SSE实时流式传输到前端
- **最大token**：2000

### Node 10: Output Persistence（输出持久化）
- **类型**：数据库写入
- **功能**：将DM回应保存到 `session_messages` 表

### Node 11: HP/MP Updater（生命/法力更新器）
- **类型**：数据库读写
- **功能**：应用 HP_DELTA、MP_DELTA、NPC_HP_DELTA、NPC_MP_DELTA 效果
- **存储**：`player_core_stats` 表（玩家HP/MP），`session_npc_stats` 表（NPC HP/MP）
- **NPC HP/MP追踪**：
  - 使用 `session_npc_stats` 表（每session每NPC一条记录）
  - 首次战斗接触：从NPC的 `combat_stats.max_hp/max_mp` 初始化（HP和MP各自独立初始化）
  - NPC MP消耗：通过 `NPC_MP_DELTA` 效果直接扣减（Node 6 生成），不再编码在 statusName 中
  - **in_combat 标志**：首次进入战斗时设为 `true`，NPC HP≤0 时自动设为 `false`
  - **NPC 死亡**：`current_hp=0` 时自动标记 `is_alive=false, in_combat=false`

### Node 12: Inventory Updater（背包更新器）
- **类型**：数据库读写
- **功能**：处理 ITEM_CONSUMED 和 ITEM_GAINED 效果
- **操作**：减少数量/删除物品 或 upsert新物品
- **自动装备**：获得新物品时，查找世界物品目录（`items` 表）。如果 `item_stats` 含 `atk_bonus`/`damage` → 自动设 `slot_type='weapon', equipped=true`；含 `def_bonus` → 设 `slot_type='armor', equipped=true`

### Node 13: Status Effect Updater（状态效果更新器）
- **类型**：数据库读写
- **功能**：应用 STATUS_ADD 和 STATUS_REMOVE 效果
- **存储**：`player_status_effects` 表
- **结构**：status_name + description + duration（回合数）+ applied_at + expires_at
- **用途**：buff/debuff持久化（如"三回合内攻击力-1"）

### Node 14: Events Log Writer（事件日志写入器）
- **类型**：数据库写入
- **功能**：记录每回合的完整数据（用于可观测性和回放）
- **记录内容**：玩家消息、意图、骰子数据、结果、效果、DM回应预览、延迟

### Node 15: Attribute Updater（属性更新器）
- **类型**：数据库读写
- **功能**：应用 ATTRIBUTE_GAIN 效果（五维属性+1）
- **存储**：`player_custom_attributes` 表（combat/persuasion/chaos/charm/wit列）

### Node 16: Milestone Detector（里程碑检测器）
- **类型**：LLM工具调用
- **模型**：MODEL_FAST (gpt-4.1)
- **功能**：评估本回合事件是否构成里程碑（重要事件）
- **5维评分**：
  - plot_impact（0-30）：主线推进
  - conflict_intensity（0-20）：冲突强度
  - acquisition（0-20）：获得/失去重要事物
  - moral_weight（0-15）：道德重量
  - narrative_uniqueness（0-15）：叙事独特性
- **阈值**：总分 ≥ 40 才记录为里程碑
- **存储**：`session_milestones` 表

### Node 17: Story Node Completion（故事节点完成检测）
- **类型**：LLM工具调用
- **模型**：MODEL_FAST (gpt-4.1)
- **功能**：
  - 17A：检查活跃故事节点的 completion_trigger 是否被满足
  - 17B：玩家死亡时激活 ending_bad 节点
- **完成后操作**：标记当前节点completed → 激活后续节点（通过story_edges）
- **结局处理**：完成 climax 节点时，如有活跃战斗NPC，强制击杀（`current_hp=0, is_alive=false, in_combat=false`）

### Node 18: NPC Memory Updater（NPC记忆更新器）
- **类型**：LLM工具调用
- **模型**：MODEL_FAST (gpt-4.1)
- **功能**：根据本轮交互更新NPC的态度、状态、关键记忆
- **存储**：`session_npc_memories` 表

### 位置系统（Location System）
- **类型**：混合（数据库查询 + 正则匹配 + LLM 确认）
- **位置**：Node 3 系列之后、Node 0 之前执行（DM 生成前）
- **功能**：检测玩家是否移动到新地点，更新 `sessions.current_location_id`
- **三步流程**：
  1. **加载 + 自动初始化**：从 `sessions` 表读取 `current_location_id`。如果为 null，从活跃故事节点的 `location_id` 初始化，兜底取世界首个地点
  2. **3-pass 正则匹配**（快速候选检测）：
     - **Pass 1**：移动动词（进入/去/到/前往/走向...）+ 地点名/别名双向子串匹配
     - **Pass 2**：移动关键词 vs 故事节点 `interactive_hints` → 解析到关联 `location_id`
     - **Pass 3**："离开"动词（走出/离开/退出...）+ 当前地点名匹配 → 跳转首个连通地点
  3. **LLM 权威确认**：正则候选结果提交 LLM 做最终判定。LLM 排除假设性语句（"如果我去X"）、提问（"去X会怎样"）等非实际移动。**可否决正则结果**——正则移动了但 LLM 说"无" → 回滚到原位置
- **条件**：仅当存在可用目的地（故事节点关联的其他地点）时执行 LLM 确认
- **回退**：LLM 调用失败时保留正则结果（如果有）
- **与战斗的关系**：位置系统在战斗安全网之前执行，不受战斗状态影响

### Node 0: Action Validity Gate（行动有效性门控）
- **类型**：纯函数（数据库查询 + 逻辑判定）
- **位置**：在位置系统之后、Node 4 之前执行
- **功能**：检查玩家引用的物品是否可达（存在于背包中）
- **触发条件**：`intent=ITEM_USE` 或 `intent=SPELL_CAST`
- **检查逻辑**：遍历 `mentionedEntities` 在 `player_inventory` 中查找匹配物品
- **失败处理**：短路返回提示"你没有该物品"，不进入后续节点
- **设计意图**：尽早拦截无效操作，避免浪费 LLM 调用

### Node 19: Narrative State Sync（叙事状态同步）
- **类型**：LLM工具调用
- **模型**：MODEL_FAST (gpt-4.1)
- **功能**：从DM叙事文本中检测**物品**获取/失去/使用，同步到数据库。新增**严格目录验证**
- **不检测的内容**：
  - 技能/法术的**使用**（通过MP消耗处理，不从背包扣除）
  - **注意**：技能的"学习/习得"可由DM叙述触发，但必须通过世界目录验证——gained物品必须存在于items表或abilities表中，且abilities必须有NPC拥有
- **3种物品变化类型**：gained（获得）、lost（失去）、used（使用/消耗物理道具）
- **严格判定规则**：物品"存在于场景中"≠玩家"获得"。必须同时满足：玩家有获取意图 + DM确认获取动作
- **严格目录验证**（新增）：
  - `gained` 物品必须在世界 `items` 表或 `abilities` 表中找到匹配（ilike模糊匹配）
  - 如果匹配到 ability 而非 item：额外检查是否有 NPC 拥有该技能（`npc_abilities` 表）
  - 不在世界目录中的物品/技能 → 静默跳过（`continue`），不入库
  - 防止DM幻觉创造不存在的物品（如"液体操控"）
- **防重复**：如果物品已被 Node 12 添加，跳过重复插入，只补充目录元数据（item_id、description）
- **流程**：分析DM文本 → 严格目录验证 → 模糊匹配世界物品目录 → upsert到 player_inventory
- **位置**：Phase 3 执行，因为需要完整的DM回应

### Node 19B: Equipment Manager（装备管理器）
- **类型**：LLM解析 + 确定性执行（两阶段）
- **模型**：MODEL_FAST (gpt-4.1)（Phase A 解析）
- **位置**：Phase 4，在 Node 19 之后执行（确保叙事获取的物品已入库）
- **Phase A — LLM解析**：通过 `equip_actions` 工具调用从玩家消息中提取装卸指令
  - 支持复杂输入：如"先卸下A，再装备BCD到各栏位"
  - 批量展开："装备所有" → 从背包清单逐一展开为独立操作
  - 消耗品（药水等）自动排除
- **Phase B — 确定性执行**：验证 + 写DB
  - 物品存在性校验：背包中是否有该物品
  - 类别→槽位约束（硬拒绝）：weapon → weapon_1/weapon_2，armor → armor_chest，accessory → accessory_1-4
  - 槽位自动检测：根据 item_stats 推断类别，找空闲槽位
  - 自动置换：目标槽位已有装备时，先卸下旧装备再装入新装备
- **回退**：LLM解析失败时返回空数组，静默跳过

### Node 7-post: Dynamic Field Update（动态字段更新）
- **类型**：LLM工具调用
- **模型**：MODEL_FAST (gpt-4.1)
- **功能**：分析DM回应，更新玩家动态字段（如"金币"、"声望"等世界定义的自定义字段）
- **HP/MP 安全守卫**：当 `hpDeltaAppliedByNode11=true` 时，拒绝更新 hp/mp 字段，防止双重扣血
- **core_stats 同步**：当 `hpDeltaAppliedByNode11=false`（非战斗回合，如叙事伤害）且 LLM 更新了 hp/mp 字段时，同步到 `player_core_stats` 表，确保前端 HP 条实时反映变化

---

## 三、战斗系统详解

### 战斗触发条件

战斗分支在 workflow.ts 中触发，条件为：
```typescript
targetNpc?.combat_stats?.is_hostile && targetNpcCombatStats &&
playerExplicitlyNamedTarget &&  // 玩家必须明确指名敌人
(effectiveScenarioEvent.diceType === 'COMBAT' ||
 intent.intent === 'COMBAT' || intent.intent === 'SPELL_CAST')
```

即：存在敌对NPC + **玩家明确指名了该NPC** + 以下任一条件：
1. Node 3C 选择了 COMBAT 骰子
2. 玩家意图是 COMBAT 或 SPELL_CAST

**重要**：RAG 可能通过语义相似度返回 hostile NPC（如"释放火球术"返回幻影刺客），但如果玩家没有在消息中提到该NPC的名字，不会触发战斗。`playerExplicitlyNamedTarget` 通过比对 `intent.targetEntity` / `intent.mentionedEntities` 与 NPC 名称判定。

### 战斗安全网

在 Node 3C 执行后，workflow 检查 `session_npc_stats.in_combat=true` 的 NPC 是否存在（`preInCombat`）。**仅当玩家意图为 COMBAT 或 SPELL_CAST 时**，如果 Node 3C 返回 `triggered=false`，强制覆盖为：
```typescript
const isCombatIntent = intent.intent === 'COMBAT' || intent.intent === 'SPELL_CAST'
if (preInCombat && !effectiveScenarioEvent.triggered && !isEquipActionInCombat && isCombatIntent) {
  // 强制覆盖
  { triggered: true, diceType: 'COMBAT', dc: 6, eventTitle: '战斗继续', ... }
}
```
**意图过滤**：非战斗意图（EXPLORE、ITEM_USE、SOCIAL等）在战斗中不被强制触发骰子。例如"捡起试炼之印离开"（EXPLORE）不会攻击友好NPC，而是由 Node 3C 自行决定是否roll。NPC 仍可通过 Node 6 的免费攻击机制反击玩家的非攻击操作。

### 回合制战斗 SSE 事件

| 事件 | 时机 | 数据 |
|------|------|------|
| `combat_start` | 首次进入战斗 | NPC name, HP, ATK, DEF |
| `combat_info` | 每回合开始 + Node 11 后（二次发送） | NPC 当前 HP/MP/ATK/DEF + **npcAction**（本回合NPC行动描述） |
| `combat_victory` | NPC HP ≤ 0 | NPC name |
| `combat_end` | 战斗结束（胜利/结局） | reason |
| `game_complete` | 结局节点激活 | ending name |

**combat_info 二次发送**：第一次在回合开始时发（旧值），第二次在 Node 11 更新后发（新值 + npcAction），确保前端 HP 面板和NPC行动实时更新。`npcAction` 字段包含 Node 6C 选定的技能名 + 效果描述（如"使用「暗影步」→ 5点伤害"），显示在敌人面板中。

### 战斗数据流
```
玩家："对幻影刺客释放火球术"
  → [战斗安全网] preInCombat=true, 检查 triggered
  → [Node 2B] intent = SPELL_CAST, mentionedEntities=["火球术","幻影刺客"], targetEntity="幻影刺客"
  → [Node 3A] RAG检索幻影刺客（含combat_stats + id）
  → [playerExplicitlyNamedTarget] 比对 mentionedEntities/targetEntity 与 NPC 名称 → true
  → [Node 3C] 触发WIT骰（施法=才智），DC=8。inCombat=true 注入强制指令
  → [装备/NPC预处理]（所有意图均执行）
      → 查询玩家所有已装备物品的atk_bonus/def_bonus → 计算equipATKBonus/equipDEFBonus
      → 玩家总ATK = player_core_stats.attack + equipATKBonus
      → 玩家总DEF = player_core_stats.defense + equipDEFBonus
      → 从RAG结果或session_npc_stats提取目标NPC（优先用in_combat的NPC）
      → 从npc_equipment加载NPC装备的atk_bonus/def_bonus → NPC总ATK/DEF
      → 从session_npc_stats加载NPC当前HP/MP
      → 从npc_abilities + abilities表加载NPC的技能列表
  → [技能查找] 遍历 mentionedEntities→abilities表 ilike 匹配
      → "火球术"命中 → playerAbilityDamage=8, playerAbilityMpCost=3
  → [Node 6C] NPC战斗策略Agent（LLM）
      → 传入NPC状态 + 玩家状态 + 技能列表
      → LLM选择最优行动（攻击技能/治疗技能/普通攻击）
      → 回退：HP<30%选治疗，否则选最高伤害技能
  → [Node 6] 结果合成（inCombat=true，即使diceType=WIT也计算伤害）
      → 骰子结果决定结局类型（成功/失败/大成功等）
      → 伤害计算：
         SPELL_CAST → damage = max(1, ability_damage - NPC_DEF)（独立于玩家ATK）
         COMBAT     → damage = max(1, 玩家总ATK - NPC_DEF)
      → 生成HP_DELTA（玩家受伤）+ NPC_HP_DELTA（NPC受伤）+ SPELL_SLOT_USED（MP消耗）
  → [Node 9] 流式生成DM叙事
  → [战斗摘要] SSE meta 事件，视角正确的分栏格式
  → [Node 11] 状态更新
      → 玩家HP/MP更新（player_core_stats）
      → NPC HP/MP更新（session_npc_stats表）
  → [combat_info 二次发送] 更新后的NPC HP
  → [combat_victory 检测] NPC HP≤0 → 战斗胜利
```

### 战斗摘要格式

Node 9 流完成后，workflow 生成结构化战斗摘要作为 SSE meta 事件：
```
---
⚔ 本回合战况

▸ 玩家 Rain
  行动：对幻影刺客造成14点伤害（ATK10 - DEF3 ×2暴击）
  HP 12/12 → 12/12 | MP 10/10 → 10/10

▸ 幻影刺客
  行动：使用「暗影步」→ 对Rain造成4点伤害（ATK6 - DEF2）
  HP 15/15 → 1/15 | MP 10/10 → 5/10
---
```

关键设计：
- **玩家行动**：从 NPC_HP_DELTA 效果推导（玩家造成的伤害）
- **NPC行动**：从 HP_DELTA 效果推导（NPC造成的伤害）+ Node 6C 选择的技能名
- **非战斗操作**：当 `!scenarioEvent.triggered` 时，玩家行动显示"未进行战斗行动（浪费回合）"
- **无效果时**：当 `inCombat=true` 且 `mechanicalEffects.length===0` 时，仍显示双方 HP/MP

### ATK-DEF 战斗公式
```
玩家物理攻击(COMBAT):      damage = max(1, 玩家总ATK - NPC总DEF)
玩家法术攻击(SPELL_CAST):  damage = max(1, ability_damage - NPC总DEF)   ← 独立于玩家ATK
玩家攻击性物品(ITEM_USE):  damage = max(1, 玩家总ATK - NPC总DEF)   ← 无hp/mp_restore的物品
玩家治疗物品(ITEM_USE):    不造成伤害   ← 有hp_restore或mp_restore的物品
NPC技能攻击:               damage = max(1, ability.damage - 玩家总DEF)
NPC普通攻击:               damage = max(1, NPC总ATK - 玩家总DEF)
暴击:                      damage × 2
NPC免费攻击（玩家浪费回合）: damage = max(1, NPC_ATK - 玩家总DEF)
```

**关键设计决策**：
- 法术伤害使用 `ability_damage`（技能本身的伤害数值），不叠加玩家ATK
- ITEM_USE 区分治疗型（有 `hp_restore`/`mp_restore`）和攻击型（无恢复属性），前者不对NPC造成伤害
- TODO: 计划为 item_stats 增加 `damage` 字段，攻击性物品用 `max(1, item_damage - NPC_DEF)` 代替 ATK-DEF

### 装备槽位系统（9槽位，玩家和NPC共用）

| 槽位 | slot_type | 提供属性 |
|------|-----------|---------|
| 武器1 | weapon_1 | atk_bonus |
| 武器2 | weapon_2 | atk_bonus |
| 头盔 | armor_head | def_bonus |
| 胸甲 | armor_chest | def_bonus |
| 腿甲 | armor_legs | def_bonus |
| 饰品1-4 | accessory_1-4 | atk_bonus 和/或 def_bonus |

### item_stats JSONB规范

| 类型 | 结构 |
|------|------|
| 武器 | `{"type":"weapon","atk_bonus":5}` |
| 护甲 | `{"type":"armor","armor_slot":"head\|chest\|legs","def_bonus":3}` |
| 饰品 | `{"type":"accessory","atk_bonus":1,"def_bonus":1}` |
| 消耗品 | `{"type":"consumable","hp_restore":5,"mp_restore":0}` |

### 伤害表（以NPC攻击玩家为例）

| 玩家骰子结果 | NPC→玩家伤害倍率 | 示例（净伤害5） | 玩家→NPC伤害倍率 |
|------|----------|----------------|----------------|
| CRITICAL_FAILURE | ×2（毁灭性打击） | -10 HP | 不攻击 |
| FAILURE | ×1（命中） | -5 HP | 不攻击 |
| PARTIAL | ×0.5 (向上取整) | -3 HP | ×0.5（互换） |
| SUCCESS | ×0.25 (向上取整, min 1)（擦伤） | -2 HP | ×1（命中） |
| CRITICAL_SUCCESS | 不受伤（完全闪避） | 0 | ×2（暴击） |

---

## 四、数据库核心表

| 表名 | 用途 | 关键列 |
|------|------|--------|
| `worlds` | 世界设定 | name, setting, tone, description, starter |
| `npcs` | NPC定义 | name, description, personality, combat_stats(JSONB), embedding |
| `items` | 物品定义 | name, description, item_stats(JSONB), embedding |
| `abilities` | 能力定义 | name, description, ability_stats(JSONB), embedding |
| `npc_abilities` | NPC-能力关联 | npc_id, ability_id |
| `npc_equipment` | NPC装备（世界级） | npc_id, item_id, item_name, slot_type |
| `story_nodes` | 故事节点 | name, node_type, completion_trigger, ending_script |
| `story_edges` | 故事边 | from_node_id, to_node_id, edge_type |
| `sessions` | 游戏会话 | world_id, current_quest_id |
| `players` | 玩家 | session_id, dynamic_fields(JSONB) |
| `player_core_stats` | 玩家核心属性 | current_hp, max_hp, current_mp, max_mp, attack, defense |
| `player_inventory` | 玩家背包 | item_name, quantity, equipped, slot_type, item_id(FK) |
| `player_status_effects` | 状态效果 | status_name, description, duration, applied_at |
| `player_custom_attributes` | 五维属性 | combat, persuasion, chaos, charm, wit |
| `session_npc_stats` | NPC战斗状态 | current_hp, max_hp, current_mp, max_mp, is_alive, **in_combat** |
| `session_milestones` | 里程碑 | event_summary, event_type, total_score |
| `session_story_state` | 故事进度 | node_id, status(active/completed) |
| `session_npc_memories` | NPC记忆 | npc_id, attitude, status, key_memories |
| `session_events` | 事件日志 | intent_type, outcome_type, mechanical_effects |

---

## 五、前端关键组件

### 玩家面板
- **默认收起**：compact 单行模式，显示名字 + HP/MP/ATK/DEF + 动态字段 + 五维属性 + 背包概要
- **展开后**：完整编辑表单 + 物品/技能详情

### 物品系统（已装备/背包/技能分区）
- **已装备**（橙色 #E8A87C，剑图标）：`equipped=true` 或有武器/防具 stats 的物品
- **背包**（金色 #F2B880，包图标）：未装备的普通物品
- **技能**（青色 #6EE7F2，星星图标）：`slot_type='ability'`
- 每个物品标签显示名字 + stat标签（ATK+4, DEF+2, HP+5 等）
- 点击展开显示物品描述

### 敌人面板
- **可折叠**：默认只显示名字 + HP bar + 展开按钮
- 展开后显示 ATK/DEF/技能/装备
- 数据来自 `combat_info` SSE 事件

### 战斗摘要
- 作为 `author: 'combat_summary'` 消息持久显示
- 视角正确的双栏格式

### 进度条
- 只前进不后退（`maxProgress` state）
- 对应 pipeline 各阶段的 SSE status 事件

---

## 六、面试问答准备

### Q: 请大致讲一下你设计的LangChain/Agent流程

**A:**
我们的系统不是传统的LangChain链式调用，而是一个**自定义的20节点多智能体流水线**。每次玩家发消息，流水线执行以下步骤：

1. **意图分析阶段**（并行）：首先验证输入，然后同时进行两件事——从数据库加载世界和玩家数据，以及用100% LLM Function Calling将玩家消息分类为7种意图之一（战斗、施法、物品使用、探索、社交、叙事、元问询）。所有正则分类已移除，分类完全依赖 `classify_intent` 工具调用。

2. **上下文检索阶段**（并行）：基于分类结果，并行执行6个子任务——意图感知的向量RAG检索、玩家状态加载、场景事件生成（决定是否roll骰子和DC值）、里程碑加载、故事节点加载、NPC记忆加载。

3. **预处理阶段**（顺序）：位置系统（3-pass正则+LLM权威确认，DM生成前执行）→ 行动有效性门控（Node 0，物品可达性）→ 模糊目标拦截（"敌人""怪物"等泛称短路拒绝）→ 战斗安全网（`in_combat=true` 时强制触发骰子）→ 重试惩罚（同地点同类型连续失败 → DC+2，3次锁定）。

4. **机械判定阶段**（顺序）：先验证前置条件（Node 4），再执行d12骰子引擎（Node 5），然后装备ATK/DEF汇总+NPC预处理，NPC战斗策略选择（Node 6C），MP前置检查，最后用纯函数合成结果（Node 6）——这步完全不用LLM，而是确定性的规则计算。

5. **叙事生成阶段**：死亡预检测（HP投影≤0时注入结局台本）→ 上下文组装（Node 7）→ Prompt构造（Node 8）→ GPT-4.1流式生成DM叙事（Node 9）→ 战斗SSE事件 → 死亡/结局检测。

6. **状态更新阶段**（4个Phase + SSE进度）：
   - **Phase 1**（并行）：HP/MP更新(11)、背包更新(12)、状态效果(13)、事件日志(14)、属性增长(15)、里程碑检测(16)、故事节点完成(17)、NPC记忆(18)、**技能机械授予**（learningAbility成功→直接入库）
   - **Phase 1.5**：combat_info二次发送（更新后HP/MP + npcAction）→ combat_victory检测 → game_complete检测
   - **Phase 2**：动态字段更新（Node 7，等Node 11完成避免竞态）→ 同步HP/MP到core_stats
   - **Phase 3**：叙事状态同步（Node 19，LLM分析DM文本→物品入库，不检测技能使用）
   - **Phase 4**：装备管理器（Node 19B，LLM解析装卸指令→确定性DB执行）

### Q: 设计过程中遇到过什么问题？

**A:**

1. **竞态条件**：Node 11（HP更新）和Node 7（动态字段更新）都读写 `players.dynamic_fields`，如果并行执行会互相覆盖。解决方案是强制Node 7等Node 11完成后再执行。

2. **ATK-DEF战斗体系**：从D&D六属性简化为ATK/DEF/HP/MP四属性，统一战斗公式`max(1, ATK-DEF)`。装备系统通过9个槽位（2武器+3护甲+4饰品）提供atk_bonus/def_bonus加成。

3. **NPC战斗策略**：最初NPC技能选择是纯函数（选最高伤害），后改为LLM Agent（Node 6C）。Agent考虑NPC HP/MP比例、玩家威胁等因素做战术决策，失败时回退纯函数。

4. **LLM幻觉导致战斗中断**：Node 3C（场景事件生成器）在活跃战斗中仍可能返回 `triggered=false`，导致玩家明确说"继续攻击"却显示"未采取行动"。解决方案：(a) 向 Node 3C prompt 注入 inCombat 战斗状态警告，(b) workflow 层面设置安全网强制覆盖。

5. **战斗触发条件过窄**：最初只有 `diceType=COMBAT` 才进入战斗分支，导致施法攻击（WIT骰）不触发战斗伤害。改为 `diceType=COMBAT || inCombat`。同时增加了 `playerExplicitlyNamedTarget` 门控——RAG 可能通过语义相似度返回 hostile NPC，但必须玩家在消息中明确提到该NPC才触发战斗，防止"释放火球术"（无目标）误触发。

6. **物品自动装备**：玩家通过剧情获得武器后，`equipped` 默认 `false`，前端"已装备"区域永远为空。解决方案：Node 12 和 Node 19 获得物品时自动查找世界物品目录，有 ATK/DEF 属性的物品自动装备。

7. **HP 双重扣除**：Node 11 处理战斗伤害后，Node 7（动态字段更新）的 LLM 又根据 DM 文本二次扣血。解决方案：引入 `hpDeltaAppliedByNode11` 标志，当战斗已处理HP时 Node 7 跳过 hp/mp 字段。

8. **PostgreSQL RPC返回类型变更**：`match_npcs` RPC新增 `combat_stats` 返回列时，`CREATE OR REPLACE FUNCTION` 报错"cannot change return type"。必须先 `DROP FUNCTION` 再重建。

9. **前端刷新时序**：最初后台节点是Fire-and-Forget异步，前端需要多次延时刷新（0s/6s/10s）。改为Awaited模式后，所有更新在done事件前完成，前端刷新一次即可。

10. **意图感知RAG精度**：最初所有实体用同一个检索策略，导致COMBAT意图下也返回无关地点。改为根据意图类型调整检索权重和目标表。

11. **DC自适应**：最初DC范围固定4-11，但玩家属性增长后（如战斗值30），即使最高DC 11也轻松通过。解决方案是引入自适应DC上限：`11 + floor(attr/5) * 2`，每5点属性让DC上限增加2。

12. **叙事状态同步误判技能为物品**：Node 19 的 LLM 将"使用火球术"解读为物品消耗，从背包中扣除了技能。解决方案：在 system prompt 中明确区分——施放技能/法术通过MP消耗，不是物品消耗；只有物理消耗品（药水、卷轴等）才算 `used`。

13. **装备管理从LLM叙事分析改为独立管理器**：最初 Node 19 同时检测物品变化和装备/卸装，但LLM分析DM叙事文本的装备判定不可靠。解决方案：拆分为 Node 19B 独立装备管理器——Phase A 用LLM从**玩家原始消息**（非DM叙事）解析装卸指令，Phase B 用确定性逻辑执行DB操作。

---

## 七、设计亮点

1. **并行化**：利用Promise.all最大化并行，将总延迟控制在可接受范围
2. **纯函数隔离**：Node 4/5/6是纯函数，无LLM无数据库，确保确定性和可测试性
3. **Awaited + SSE进度模式（4 Phase）**：Node 10持久化后，await 4个Phase的状态更新完成再返回done事件。通过SSE status事件实时展示更新进度。好处是前端刷新一次即可获取最新状态
4. **意图感知RAG**：不是盲目检索所有表，而是根据意图类型精准检索相关实体
5. **100% LLM 意图分类**：所有正则模式匹配已移除，分类完全依赖 Function Calling。正则维护成本高且中文表达覆盖不全，GPT-4.1 function calling 足够快（<200ms）
6. **五维属性 + 自适应DC**：玩家属性真正影响骰子结果，DC随属性增长而增长
7. **NPC记忆系统**：NPC跨回合记住玩家行为，态度会随交互变化
8. **里程碑系统**：5维评分自动检测重要事件，为长期叙事提供记忆锚点
9. **叙事状态同步**（Node 19）：从DM文本中自动检测物品获取/失去/使用，同步到数据库。严格区分技能使用（MP消耗，不扣背包）和物品消耗（一次性道具）
10. **装备管理器**（Node 19B）：LLM解析+确定性执行的两阶段设计。支持批量操作（"装备所有"）、类别→槽位约束、自动置换
11. **战斗安全网**：对 LLM 幻觉的防御机制，确保战斗中 Node 3C 不会意外中断回合
12. **自动装备检测**：获得武器/防具时自动装备，免去手动操作，提升游戏流畅度
13. **模糊目标拦截**：玩家使用"敌人""怪物"等模糊说法攻击时，pipeline 短路并提示指明具体名称。同时排除已知NPC名（如"怪物猎人"不会被误拦）
14. **场景一致性 + 动态NPC**：Node 4 场景检查同时接受 interactive_hints（静态）和 RAG 世界NPC（动态），支持通过故事事件召唤的NPC直接进入战斗
15. **NPC 多技能类型**：NPC支持攻击技能（damage>0）、治疗技能（hp_restore>0）、吸血技能（hp_restore<0，无视DEF），由 Node 6C LLM Agent 根据战场情况选择
16. **重试惩罚机制**：同地点同类型连续失败 → DC+2/次，3次失败 → 该操作锁定，防止暴力重试
17. **自定义DC阈值**：世界设计者可在NPC的combat_stats中设置dc_thresholds（五维DC），在ability/item的stats中设置acquisition_dc（获取难度），Pipeline在Node 3C之后用确定性值覆盖LLM生成的DC
18. **机械技能学习**：Node 4验证技能存在性+NPC所有权 → learningAbility携带信息通过Pipeline → Phase 1中grantLearnedAbility()确定性入库。绕过"DM叙述→Node 19检测"的脆弱链路
19. **技能真实性守卫**：多层防御——Node 4 SPELL_CAST世界目录交叉验证、Node 19严格目录验证、DM prompt Rule 9禁止虚构技能。杜绝"液体操控"等幻觉技能
20. **战斗安全网意图过滤**：安全网只对COMBAT/SPELL_CAST意图强制触发骰子，EXPLORE/ITEM_USE/SOCIAL等非战斗意图在战斗中不被强制（如"捡起物品离开"不会攻击NPC）
