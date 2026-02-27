# TODO — 待实现功能清单

> 按优先级排列。标注 `[P0]` 紧急 / `[P1]` 重要 / `[P2]` 优化 / `[P3]` 远期

---

## 战斗系统

- ~~**[P1] NPC技能选择改为LLM Agent**~~ ✓ 已完成（Node 6C）
- ~~**[P1] 装备/NPC技能查询泛化（不限COMBAT意图）**~~ ✓ 已完成（移除COMBAT guard）

- **[P2] Debuff自动生成**
  - 当前：ability_stats没有debuff定义字段；Node 6不生成STATUS_ADD效果
  - 目标：ability_stats增加 `debuff_name`、`debuff_duration`、`debuff_description` 字段
  - Node 6在NPC使用带debuff的技能命中玩家时，自动生成STATUS_ADD效果
  - 需要migration扩展ability_stats的JSONB结构

- **[P2] Debuff影响战斗计算**
  - 当前：Node 4/5不读取玩家的statusEffects
  - 目标：Node 5骰子引擎读取debuff并应用修正（如"攻击力-1"影响伤害计算）
  - Node 4检查控制类debuff（如"眩晕"阻止行动）

- **[P2] 状态效果duration倒计时**
  - 当前：status_effects一旦添加就永久存在，没有每回合递减duration
  - 目标：在每回合开始（Node 3B之前或之后）检查所有有duration的效果，递减1，归零则删除
  - 可以在workflow.ts的开头加一个轻量的"status effect tick"步骤

---

## 骰子系统

- **[P1] 骰子点数动态维护**
  - 当前：DC自适应公式 `Math.min(50, 11 + floor(attr/5) * 2)` 在3C中
  - 目标：根据故事进度、玩家等级、NPC强度等因素动态调整DC
  - 考虑：是否需要引入"难度等级"概念（普通/困难/噩梦）

- **[P2] 状态效果影响骰子点数**
  - 当前：`player_status_effects` 表记录了buff/debuff，但Node 5骰子引擎完全不读取
  - 目标：
    1. Node 5读取玩家当前的 `status_effects`，根据effect_type应用骰子修正
    2. 例如："攻击力+2" buff → COMBAT骰子+2修正；"眩晕" → 骰子-3修正
    3. 在Node 3C的DC计算中也考虑status effect（如"诅咒"提高DC）
  - 涉及文件：`5-dice-engine.ts`、`3c-scenario-event-generator.ts`、`workflow.ts`
  - 前置：需先定义 `effect_type` 的标准枚举和修正值规范

---

## 时间系统

- **[P1] 时间追踪 + 时间敏感Agent Node**
  - 当前：无时间概念，法术位用完就用完
  - 目标：
    1. 追踪游戏内时间（回合数 / 日夜周期）
    2. 新增时间判断Agent Node，在每回合更新时间状态
    3. 法术位在"休息"后恢复（短休/长休机制）
    4. 某些事件/NPC只在特定时间出现
  - 存储：sessions表增加 `game_time` 字段（或新建 `session_time_state` 表）

---

## Prompt优化

- **[P1] 优化Node 7/8上下文拼接**
  - 当前：所有上下文一股脑拼接成一个巨大的prompt，LLM可能吃力
  - 目标：
    1. 按重要性排序上下文段落，不相关的段落压缩或省略
    2. 对超长对话历史做摘要（而非直接截断最近5条）
    3. 考虑分离"世界知识prompt"和"当前回合prompt"，用system message和user message分装
    4. 添加token计数，超过限制时智能裁剪最不重要的上下文

- ~~**[P4] 某个事件骰子判定失效后则限制尝试次数与难度**~~ ✓ 已完成（workflow.ts 重试惩罚：DC+2/次，3次后锁定）

- **[P4] 某个事件骰子点数设置比较随意**
  - 当前：LLM决定
  - 目标：可以人为额外覆盖定义

- **[P2] Rules分类：战斗规则传入Node 3C骰子判定**
  - 当前：Rules只传给DM叙述prompt（Node 7/8），Node 3C完全不读rules
  - 目标：
    1. `rules`表加`category`字段（`combat` / `narrative`）
    2. Manage World UI加分类选择器
    3. workflow.ts并行批之前查combat rules，传给Node 3C
    4. Node 3C prompt中拼入combat rules文本，LLM据此校准DC
  - 效果：用户在rules中写"幻影刺客DC默认为8"，Node 3C会参考
  - 已有rules默认归为narrative，向后兼容
  - 涉及文件：`fresh_start.sql`、`2-data-retrieval.ts`、`rule-manager.tsx`、`workflow.ts`、`3c-scenario-event-generator.ts`


---

## 前端

- ~~**[P2] 物品/能力实时更新**~~ ✓ 已完成（Fire-and-Forget→Awaited，前端等待SSE done事件后刷新）

- **[P2] 前端可拖拽装备管理UI**
  - 当前：装备/卸下只能通过对话指令（如"装备X到主手"），后端由Node 19B确定性解析执行
  - 目标：物品栏和装备栏之间支持拖拽式装备/卸下，不需要每次都通过对话
  - 设计：装备栏显示slot格子（主手/副手/护甲/饰品），物品栏拖入格子=装备，拖出=卸下
  - 涉及：`page.tsx`前端组件、直接调用Supabase更新`player_inventory`的equipped/slot_type

---

## 法术位系统

- **[P2] 法术位+休息恢复（世界模组扩展）**
  - 当前：法术位类型和表保留但不启用检查
  - 目标：法术位分级（1-9级），短休/长休恢复机制
  - 前置：时间系统实装后方可实现

## 前置校验（Node 4）

- **[P2] Scene Coherence扩展到非COMBAT意图**
  - 当前：场景一致性检查仅COMBAT触发
  - 目标：SOCIAL/EXPLORE等意图也检查目标实体是否在场景中

- **[P2] 消耗品效果校验（根据item_stats）**
  - 当前：ITEM_USE仅检查物品存在，不验证效果合理性
  - 目标：根据item_stats.type校验使用条件

- **[P3] Debuff阻止行动（眩晕/沉默）**
  - 当前：Node 4不读取statusEffects
  - 目标：控制类debuff阻止特定行动类型

## 装备系统

- **[P2] 物品自身伤害值（item_stats.damage）**
  - 当前：ITEM_USE攻击时走 `max(1, playerATK - npcDEF)` 物理公式，item_stats 的 `special_effect` 只是文本描述，不参与机械计算
  - 目标：
    1. `item_stats` 增加 `damage` 数字字段（类似 ability_stats.damage）
    2. Node 6 在 ITEM_USE 攻击时读取 `item_stats.damage`，有值则用 `max(1, item_damage - npcDEF)` 代替 ATK-DEF 公式
    3. 无 `damage` 字段的物品仍回退 ATK-DEF 公式
  - 涉及文件：`workflow.ts`（读取 item_stats.damage 传入 Node 6）、`6-outcome-synthesizer.ts`（新增 ITEM_USE 伤害分支）

- **[P2] 装备HP/MP加成（饰品hp_bonus/mp_bonus）**
  - 当前：装备仅提供atk_bonus和def_bonus
  - 目标：饰品可提供hp_bonus/mp_bonus，增加maxHp/maxMp

## 架构

- ~~**[P3] 移除Phase 2回退路径**~~ ✓ 已完成（Node 3B/11不再回退dynamic_fields）

- **[P3] 节点编号规范化**
  - 当前：编号混乱（有6B、6C、3A-F、7复用、19等）
  - 目标：统一重编为连续数字，更新所有日志和文档

