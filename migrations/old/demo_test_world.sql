-- ═══════════════════════════════════════════════════════════════════════════
-- DEMO TEST WORLD — 幻象试炼场 (Phantom Trial Arena)
--
-- 前置条件：必须已执行 fresh_start.sql
--
-- 包含：
--   - 1 个世界 + 3 个地点 + 2 个NPC + 6 个物品 + 2 个规则
--   - 1 条主线任务 + 7 个故事节点 + 8 条边
--   - 3 个NPC技能 + NPC技能链接(droppable) + NPC装备链接(droppable)
--   - NPC combat_stats（base ATK/DEF）+ item_stats（atk_bonus/def_bonus）
--   - 结局脚本
--
-- ATK/DEF 战斗计算示例：
--   玩家: base ATK=2 + 破旧短剑 atk_bonus=3 = 总ATK 5
--   幻影刺客: base ATK=2 + 影刃匕首 atk_bonus=3 = 总ATK 5
--              base DEF=1 + 暗影轻甲 def_bonus=2 = 总DEF 3
--   玩家攻击刺客: damage = max(1, 5 - 3) = 2
--   刺客攻击玩家(无护甲): damage = max(1, 5 - 0) = 5
--
-- 插入顺序（按 FK 依赖）：
--   World → NPCs → Locations → Abilities → Rules → Quest → Story Nodes →
--   Ending Scripts → Story Edges → Items → NPC-Ability Links →
--   NPC Equipment Links → Player Fields
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. World ─────────────────────────────────────────────────────────────
INSERT INTO worlds (id, name, description, tone, setting, starter)
VALUES (
  'aaaaaaaa-0000-0000-0000-000000000001',
  '幻象试炼场',
  '一座由远古魔法维持的神秘竞技场，挑战者在此面对自己内心深处的幻象。',
  '神秘、紧张、有轻微危险感；考验勇气与机智',
  '【幻象试炼场】是一座存在于幽暗山脉深处的古老魔法竞技场，由失落文明的遗民所建造。
竞技场核心是一块直径二十米的圆形沙地，四周由黑色玄武岩看台围合，
台上永远坐着幻象观众——他们在挑战者入场时会发出若有若无的低语。
空间内有三处关键地点：入场拱门（刻有试炼规则）、裁判台（裁判奥斯卡在此就坐）、幻象祭坛（触碰者会召唤对手）。

【游戏规则】
HP（生命值）：默认10，降至0则角色死亡，游戏当回合结束。
骰子系统：五维自定义骰（战斗/游说/混沌/道德/才智），成功累计+1属性。
战斗公式：damage = max(1, 攻击方ATK - 防御方DEF)。暴击伤害翻倍。
幻影刺客：战斗骰 DC 9，极度危险。',

  '沉重的石门在你身后轰然关闭。

扑面而来的是混合着沙土与旧铁的气息。你站在一条狭长走廊的尽头——前方，一道雕刻着古老符文的拱门将走廊与竞技场分隔开来。拱门石壁上以古字刻着三行规则：

「入者，即立约。」
「胜者，得试炼之印。」
「败者，魂归幻象。」

拱门另一侧，圆形竞技场的沙地在昏黄光线中静静等待。看台上坐着数十位轮廓模糊的幻象观众，他们的头颅同时转向你，没有表情，没有声音。竞技场正中央，一块乌黑发亮的石制祭坛上方有淡蓝色光焰在跳动。裁判台方向，一个穿白衣的老者正执笔记录什么，抬起头，向你点了点头。'
)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name, setting = EXCLUDED.setting, starter = EXCLUDED.starter;

-- ── 2. NPCs ──────────────────────────────────────────────────────────────
INSERT INTO npcs (id, world_id, name, description, aliases, personality, motivations, combat_stats)
VALUES
  (
    'bbbbbbbb-0001-0000-0000-000000000001',
    'aaaaaaaa-0000-0000-0000-000000000001',
    '裁判·奥斯卡',
    '竞技场的永久裁判，一位白发老者，穿着素白长袍，手持羽毛笔记录每一位挑战者的表现。他见过数千名挑战者，语气平静如水，既不鼓励也不嘲讽。他知道幻象祭坛的秘密，但除非被问及，否则不会主动说。询问时会提供提示：「触碰祭坛之前，先想清楚你最擅长什么。」

战斗特性：奥斯卡不参与战斗，也不会被攻击触发敌意。他的存在纯粹是裁判和信息提供者的角色。如果玩家试图攻击他，攻击会穿过他的身体——他本身也是幻象的一部分。',
    ARRAY['奥斯卡', '老裁判', '白袍老者'],
    '平静、中立、略带神秘；对所有问题给出简短但意味深长的回答',
    '忠实记录每一位挑战者的命运，维护竞技场的秩序',
    '{"hp":20,"max_hp":20,"mp":0,"max_mp":0,"attack":0,"defense":2,"is_hostile":false}'::jsonb
  ),
  (
    'bbbbbbbb-0002-0000-0000-000000000001',
    'aaaaaaaa-0000-0000-0000-000000000001',
    '幻影刺客',
    '由幻象祭坛召唤的终极对手——一个完全由黑色烟雾构成的人形刺客。它没有面孔，只有两点冷白的光代替眼睛。它会模仿挑战者的动作，几乎和你一样快，但没有你的智慧。击败它的唯一方法是找到身上的光点弱点并精准打击。

战斗特性：幻影刺客擅长使用三种技能——「影刃斩」凝聚烟雾为刃进行近距离斩击（伤害6，消耗2MP）；「暗影步」化为黑雾瞬移到目标背后发动致命突袭（伤害10，消耗5MP）；当MP耗尽时，它会使用「烟雾缠绕」释放黑烟束缚目标（伤害3，无消耗）。它的MP总量为10，战斗中会优先使用伤害最高的可用技能。',
    ARRAY['刺客', '幻影', '烟雾人'],
    '沉默、冷酷、镜像般精准；不说话，只战斗',
    '消灭所有踏入竞技场的挑战者，维护幻象祭坛的封印',
    '{"hp":15,"max_hp":15,"mp":10,"max_mp":10,"attack":2,"defense":1,"is_hostile":true}'::jsonb
  )
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description, combat_stats = EXCLUDED.combat_stats;

-- ── 3. Locations ─────────────────────────────────────────────────────────
INSERT INTO locations (id, world_id, name, description, aliases)
VALUES
  (
    'cccccccc-0001-0000-0000-000000000001',
    'aaaaaaaa-0000-0000-0000-000000000001',
    '竞技场沙地',
    '直径约二十米的圆形沙地，是所有试炼的主战场。沙地质地细腻，但踩上去有奇异的温热感，仿佛有什么在地底缓缓流动。沙地四周刻有发光的边界符文，挑战者无法从边界逃出。',
    ARRAY['沙场', '圆形场地', '试炼场地', '竞技场']
  ),
  (
    'cccccccc-0002-0000-0000-000000000001',
    'aaaaaaaa-0000-0000-0000-000000000001',
    '幻象祭坛',
    '竞技场正中央的乌黑石台，高约一米，表面刻满螺旋形纹路。祭坛顶端有一朵持续燃烧的蓝色火焰，不散热，不发光，只发出轻微的嗡鸣声。触碰火焰者会立即召唤出幻影刺客。',
    ARRAY['祭坛', '蓝焰石台', '召唤台']
  ),
  (
    'cccccccc-0003-0000-0000-000000000001',
    'aaaaaaaa-0000-0000-0000-000000000001',
    '密室',
    '竞技场看台下方有一扇几乎看不见的暗门，推开后是一间狭小的石室。石室内有一张古旧木桌，桌上放着蜡烛和一本破损的试炼记录册。墙壁旁有一排锈迹斑斑的武器架，架上散落着前任挑战者遗留的战利品。空气中弥漫着金属与灰尘的气息，烛光摇曳，映照出石壁上的残墨字迹。',
    ARRAY['隐藏房间', '暗室', '石室']
  )
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description;

-- ── 4. NPC Abilities（技能 + ability_stats）───────────────────────────────
-- 影刃斩: 主力攻击，中等伤害，低MP消耗
INSERT INTO abilities (id, world_id, name, aliases, description, ability_stats)
VALUES (
  'eeeeeeee-0001-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  '影刃斩',
  ARRAY['影刃', '暗影斩击', '影刃攻击'],
  '幻影刺客凝聚烟雾形成锋利的刃状武器，向目标劈出致命一击。黑色烟雾在刀锋轨迹上留下淡淡的残影。这是幻影刺客最常用的攻击手段。',
  '{"mp_cost":2,"damage":6,"hp_restore":0,"effect_type":"active"}'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
  ability_stats = EXCLUDED.ability_stats, description = EXCLUDED.description;

-- 暗影步: 高伤害突袭，高MP消耗
INSERT INTO abilities (id, world_id, name, aliases, description, ability_stats)
VALUES (
  'eeeeeeee-0002-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  '暗影步',
  ARRAY['瞬步', '暗影闪避', '暗影突进'],
  '幻影刺客化为一团黑雾瞬间移动到目标背后，在对手反应过来之前发动突袭。被击中的目标会感到一阵刺骨的寒冷。这是幻影刺客最致命的杀招。',
  '{"mp_cost":5,"damage":10,"hp_restore":0,"effect_type":"active"}'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
  ability_stats = EXCLUDED.ability_stats, description = EXCLUDED.description;

-- 烟雾缠绕: 基本攻击，无MP消耗
INSERT INTO abilities (id, world_id, name, aliases, description, ability_stats)
VALUES (
  'eeeeeeee-0003-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  '烟雾缠绕',
  ARRAY['烟雾', '缠绕', '黑烟束缚'],
  '幻影刺客释放构成自身的黑色烟雾，像触手一样缠绕住目标的四肢，造成少量伤害并限制移动。这是幻影刺客在MP不足时的基本攻击。',
  '{"mp_cost":0,"damage":3,"hp_restore":0,"effect_type":"active"}'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
  ability_stats = EXCLUDED.ability_stats, description = EXCLUDED.description;

-- ── 5. Rules ─────────────────────────────────────────────────────────────
INSERT INTO rules (id, world_id, name, description, aliases, priority)
VALUES
  (
    'eeeeeeee-0001-0000-0000-000000000002',
    'aaaaaaaa-0000-0000-0000-000000000001',
    '试炼规则',
    '幻象试炼场的基本规则：
1. 入场即立约，不能中途退出。
2. 触碰幻象祭坛召唤对手后，必须战斗直至胜负分明。
3. 非战斗行动（探索、对话）不受骰子约束，可自由进行。
4. HP降至0时，当回合收到game_over信号，游戏结束。
5. 通过最终试炼者将获得试炼之印，可离开竞技场。',
    ARRAY['规则', '竞技场规则', '试炼约定'],
    true
  ),
  (
    'eeeeeeee-0002-0000-0000-000000000002',
    'aaaaaaaa-0000-0000-0000-000000000001',
    '战斗规则',
    '战斗公式：damage = max(1, 攻击方ATK - 防御方DEF)。暴击（骰子最大值）伤害翻倍。
NPC反击：当玩家行动失败时，NPC使用技能或普通攻击反击。
幻影刺客 ATK=5(base2+装备3), DEF=3(base1+装备2)。',
    ARRAY['刺客规则', '战斗规则', '伤害计算'],
    true
  )
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description;

-- ── 6. Quest ─────────────────────────────────────────────────────────────
INSERT INTO quests (id, world_id, title, description, quest_type, quest_order, is_active)
VALUES (
  'ffffffff-0001-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  '幻象试炼',
  '通过竞技场的重重考验，击败幻影刺客，获得试炼之印。',
  'main', 1, true
)
ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title;

-- ── 7. Story Nodes ──────────────────────────────────────────────────────
INSERT INTO story_nodes (
  id, world_id, quest_id, name, description,
  node_type, is_start_node, interactive_hints, completion_trigger, location_id
) VALUES
(
  '11111111-0001-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'ffffffff-0001-0000-0000-000000000001',
  '踏入竞技场', '挑战者刚刚进入，面对拱门与竞技场。需要做出第一步行动。',
  'start', true,
  ARRAY['入场拱门（刻有试炼规则，可阅读）', '裁判奥斯卡（在裁判台就坐，可与其对话）', '幻象祭坛（中央蓝焰，触碰可召唤对手）'],
  '玩家迈入竞技场沙地，或宣布准备开始试炼，或向裁判打招呼',
  'cccccccc-0001-0000-0000-000000000001'
),
(
  '11111111-0002-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'ffffffff-0001-0000-0000-000000000001',
  '探索密室', '玩家发现并进入看台下方的隐藏密室，找到前任挑战者遗留的装备。物品由 location_id 绑定，无需在此列出。',
  'objective', false,
  ARRAY['看台下方的暗门（几乎不可见，需要仔细观察）', '密室内的古旧试炼记录册'],
  '玩家进入了密室，或找到并拾取了试炼银徽、守护者臂铠、力量印记中的任何一个',
  'cccccccc-0003-0000-0000-000000000001'
),
(
  '11111111-0003-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'ffffffff-0001-0000-0000-000000000001',
  '从裁判处获得提示', '玩家与裁判奥斯卡进行对话，获得关于幻影刺客弱点的提示。',
  'branch', false,
  ARRAY['裁判奥斯卡（可询问关于试炼、祭坛、幻影刺客的问题）', '裁判手中的记录册'],
  '玩家与裁判奥斯卡进行了对话，并从对话中获得了关于试炼或幻影刺客的信息',
  'cccccccc-0001-0000-0000-000000000001'
),
(
  '11111111-0004-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'ffffffff-0001-0000-0000-000000000001',
  '对决幻影刺客', '玩家触碰祭坛召唤幻影刺客，或直接与幻影刺客交战。这是最终的生死考验。',
  'climax', false,
  ARRAY['幻影刺客身上的两点冷白光（弱点，需要精准打击）', '幻象祭坛（战斗开始后发出红色脉冲）', '裁判奥斯卡（静静记录，不干预战斗）'],
  '玩家成功击败了幻影刺客，或幻影刺客被消灭，或刺客的光点弱点被摧毁',
  'cccccccc-0001-0000-0000-000000000001'
),
(
  '11111111-0007-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'ffffffff-0001-0000-0000-000000000001',
  '战后收集', '刺客化为黑烟消散，遗留装备散落沙地。石门缓缓开启。',
  'objective', false,
  ARRAY[
    '幻影刺客遗落的影刃匕首（ATK+3，可拾取）',
    '幻影刺客遗落的暗影轻甲（DEF+2，可拾取）',
    '裁判奥斯卡（走向你，准备颁发试炼之印）',
    '竞技场远端缓缓开启的石门（走过去即完成试炼）'
  ],
  '玩家走向或穿过开启的石门，或明确表示要离开竞技场',
  'cccccccc-0001-0000-0000-000000000001'
),
(
  '11111111-0005-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'ffffffff-0001-0000-0000-000000000001',
  '通过试炼', '挑战者成功击败幻影刺客，获得试炼之印，竞技场开启出口。',
  'ending_good', false,
  ARRAY['裁判奥斯卡（递上试炼之印）', '竞技场出口（远处石门缓缓开启）'],
  NULL,
  'cccccccc-0001-0000-0000-000000000001'
),
(
  '11111111-0006-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'ffffffff-0001-0000-0000-000000000001',
  '试炼中陨落', '挑战者在试炼中HP归零，魂归幻象。由死亡检测系统自动激活。',
  'ending_bad', false,
  ARRAY['裁判奥斯卡（合上记录册，低头）', '幻象观众（齐声消失于黑暗）'],
  NULL,
  'cccccccc-0001-0000-0000-000000000001'
)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      interactive_hints = EXCLUDED.interactive_hints,
      completion_trigger = EXCLUDED.completion_trigger,
      location_id = EXCLUDED.location_id;

-- ── 8. Ending Scripts ───────────────────────────────────────────────────
-- 通过试炼（ending_good）
UPDATE story_nodes
SET ending_script = '裁判奥斯卡缓缓从裁判台起身。他走过沙地，靴底踏沙的声音在寂静的竞技场中格外清晰。他停在你面前，将一枚刻有竞技场图案的银印稳稳放在你掌心，然后退后一步，微微颔首。

「登记完毕。」他说，声音平静如水。他重新拿起羽毛笔，在记录册上写下什么，合上册子。

竞技场另一头，那扇沉默了不知多少年的石门发出低沉的震动声，缝隙间透出一线苍白的光，随即缓缓向两侧推开。幻象观众们安静地消散，就像蜡烛的火焰被风吹灭，不留任何痕迹。

你握紧银印，走向那道开启的门。
身后，幻象祭坛的蓝焰熄灭了。'
WHERE id = '11111111-0005-0000-0000-000000000001';

-- 试炼中陨落（ending_bad）
UPDATE story_nodes
SET ending_script = '光芒消散得很突然。

幻象刺客的最后一击落下时，你感受到的不是疼痛，而是一种奇异的轻盈。沙地从脚下退去，竞技场的轮廓逐渐模糊，化作灰蓝色的烟雾。幻象观众们没有欢呼，没有嘲讽——他们只是静静地看着，然后一个接一个地消失进黑暗里。

裁判奥斯卡在远处合上了那本记录册。他没有抬头。

刻在拱门石壁上的古字在消散前，你终于看清了最后半句，那句之前被遮住的话：

「——幻象不死，只是等待下一位。」

然后，一切归于沉寂。'
WHERE id = '11111111-0006-0000-0000-000000000001';

-- ── 9. Story Edges ──────────────────────────────────────────────────────
INSERT INTO story_edges (id, world_id, from_node_id, to_node_id, edge_type, condition)
VALUES
  ('22222222-0001-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-0001-0000-0000-000000000001', '11111111-0002-0000-0000-000000000001',
   'story', '玩家开始探索竞技场环境'),
  ('22222222-0002-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-0001-0000-0000-000000000001', '11111111-0003-0000-0000-000000000001',
   'story', '玩家选择直接与裁判对话'),
  ('22222222-0003-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-0002-0000-0000-000000000001', '11111111-0004-0000-0000-000000000001',
   'story', '玩家探索完毕，触碰幻象祭坛'),
  ('22222222-0004-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-0003-0000-0000-000000000001', '11111111-0004-0000-0000-000000000001',
   'story', '玩家从裁判处获得提示后，触碰祭坛迎战'),
  ('22222222-0005-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-0002-0000-0000-000000000001', '11111111-0003-0000-0000-000000000001',
   'shortcut', '玩家找到密室后选择先询问裁判'),
  ('22222222-0006-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-0004-0000-0000-000000000001', '11111111-0007-0000-0000-000000000001',
   'story', '玩家击败了幻影刺客，进入战后收集阶段'),
  ('22222222-0007-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-0004-0000-0000-000000000001', '11111111-0006-0000-0000-000000000001',
   'fail', 'HP降至0，死亡检测系统激活坏结局'),
  ('22222222-0008-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-0007-0000-0000-000000000001', '11111111-0005-0000-0000-000000000001',
   'story', '玩家走向石门，完成试炼')
ON CONFLICT (id) DO UPDATE
  SET from_node_id = EXCLUDED.from_node_id,
      to_node_id = EXCLUDED.to_node_id,
      edge_type = EXCLUDED.edge_type,
      condition = EXCLUDED.condition;

-- ── 10. Items（含 item_stats + location_id + unlock_node_id）─────────────
-- ⚠️ 必须在 Story Nodes 之后插入，因为 unlock_node_id 引用 story_nodes(id)
INSERT INTO items (id, world_id, name, description, aliases, is_unique, item_stats, location_id, unlock_node_id)
VALUES
  -- 试炼银徽: 装饰/任务道具（密室中，需探索密室节点解锁）
  (
    'dddddddd-0001-0000-0000-000000000001',
    'aaaaaaaa-0000-0000-0000-000000000001',
    '试炼银徽',
    '刻有竞技场图案的银色徽章，密室中遗留的历届优胜者标志。拥有它的人在竞技场内会受到幻象观众的尊重。',
    ARRAY['银徽', '徽章', '优胜徽章'],
    false,
    '{"type":"tool"}'::jsonb,
    'cccccccc-0003-0000-0000-000000000001',
    '11111111-0002-0000-0000-000000000001'
  ),
  -- 治愈水晶: 消耗品（密室中，需探索密室节点解锁）
  (
    'dddddddd-0002-0000-0000-000000000001',
    'aaaaaaaa-0000-0000-0000-000000000001',
    '治愈水晶',
    '竞技场内稀有的回复道具，使用后恢复5点HP。外观是拇指大小的淡绿色晶体，轻微发光。只能在非战斗状态下使用。',
    ARRAY['绿晶', '回复晶', '水晶'],
    false,
    '{"type":"consumable","hp_restore":5,"mp_restore":0}'::jsonb,
    'cccccccc-0003-0000-0000-000000000001',
    '11111111-0002-0000-0000-000000000001'
  ),
  -- 破旧短剑: 玩家初始武器（无固定地点，无锁）
  (
    'dddddddd-0003-0000-0000-000000000001',
    'aaaaaaaa-0000-0000-0000-000000000001',
    '破旧短剑',
    '一把略显陈旧的铁制短剑，剑身上有使用过的痕迹，但刃口仍然锋利。这是进入竞技场的挑战者最常见的武器。',
    ARRAY['短剑', '铁剑', '剑'],
    false,
    '{"type":"weapon","atk_bonus":3}'::jsonb,
    NULL, NULL
  ),
  -- 影刃匕首: 幻影刺客武器（战后收集节点解锁 → 掉落在竞技场）
  (
    'dddddddd-0004-0000-0000-000000000001',
    'aaaaaaaa-0000-0000-0000-000000000001',
    '影刃匕首',
    '幻影刺客的标配武器，刃身隐约散发黑色雾气，割裂空气时发出细微的嘶嘶声。',
    ARRAY['影刃', '匕首', '暗影刃'],
    false,
    '{"type":"weapon","atk_bonus":3}'::jsonb,
    'cccccccc-0001-0000-0000-000000000001',
    '11111111-0007-0000-0000-000000000001'
  ),
  -- 暗影轻甲: 幻影刺客护甲（战后收集节点解锁 → 掉落在竞技场）
  (
    'dddddddd-0005-0000-0000-000000000001',
    'aaaaaaaa-0000-0000-0000-000000000001',
    '暗影轻甲',
    '由暗影纤维编织的轻甲，穿着几乎不会发出任何声响，是刺客行动的标准装备。',
    ARRAY['轻甲', '暗影甲', '刺客甲'],
    false,
    '{"type":"armor","armor_slot":"chest","def_bonus":2}'::jsonb,
    'cccccccc-0001-0000-0000-000000000001',
    '11111111-0007-0000-0000-000000000001'
  ),
  -- 守护者臂铠: 密室中发现的防具（需探索密室节点解锁）
  (
    'dddddddd-0006-0000-0000-000000000001',
    'aaaaaaaa-0000-0000-0000-000000000001',
    '守护者臂铠',
    '刻有古老符文的青铜臂铠，被遗忘在密室角落。穿戴后可以感受到一层微弱的防护力场。曾属于某位试炼优胜者。',
    ARRAY['臂铠', '护臂', '守护臂铠', '青铜臂铠'],
    false,
    '{"type":"armor","armor_slot":"accessory_1","def_bonus":3}'::jsonb,
    'cccccccc-0003-0000-0000-000000000001',
    '11111111-0002-0000-0000-000000000001'
  ),
  -- 力量印记: 密室中的饰品（需探索密室节点解锁）
  (
    'dddddddd-0007-0000-0000-000000000001',
    'aaaaaaaa-0000-0000-0000-000000000001',
    '力量印记',
    '一枚刻着红色闪电纹路的石质印章，握在手中能感到灼热的力量涌入全身。密室墙壁上记载这是历届冠军的战斗遗物。装备后大幅提升攻击力。',
    ARRAY['印记', '力量之印', '红色印章', '战斗印记'],
    false,
    '{"type":"accessory","atk_bonus":5}'::jsonb,
    'cccccccc-0003-0000-0000-000000000001',
    '11111111-0002-0000-0000-000000000001'
  ),
  -- 魔力药水: 恢复MP的消耗品（密室中，需探索密室节点解锁）
  (
    'dddddddd-0008-0000-0000-000000000001',
    'aaaaaaaa-0000-0000-0000-000000000001',
    '魔力药水',
    '装在精致小瓶中的蓝色液体，散发着微光。饮用后可以恢复5点魔力值。',
    ARRAY['蓝药水', '魔力瓶', 'MP药水'],
    false,
    '{"type":"consumable","mp_restore":5,"hp_restore":0}'::jsonb,
    'cccccccc-0003-0000-0000-000000000001',
    '11111111-0002-0000-0000-000000000001'
  )
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      item_stats = EXCLUDED.item_stats, location_id = EXCLUDED.location_id,
      unlock_node_id = EXCLUDED.unlock_node_id;

-- ── 11. NPC-Ability Links（droppable: 幻影特有能力，不可学习）─────────────
INSERT INTO npc_abilities (npc_id, ability_id, droppable)
VALUES
  ('bbbbbbbb-0002-0000-0000-000000000001', 'eeeeeeee-0001-0000-0000-000000000001', false),
  ('bbbbbbbb-0002-0000-0000-000000000001', 'eeeeeeee-0002-0000-0000-000000000001', false),
  ('bbbbbbbb-0002-0000-0000-000000000001', 'eeeeeeee-0003-0000-0000-000000000001', false)
ON CONFLICT (npc_id, ability_id) DO NOTHING;

-- ── 12. NPC Equipment Links（droppable: 击败后可拾取）─────────────────────
-- 幻影刺客: 影刃匕首(weapon_1, atk+3) + 暗影轻甲(armor_chest, def+2)
-- 总ATK = base 2 + weapon 3 = 5, 总DEF = base 1 + armor 2 = 3
INSERT INTO npc_equipment (npc_id, item_id, item_name, slot_type, droppable)
VALUES
  ('bbbbbbbb-0002-0000-0000-000000000001', 'dddddddd-0004-0000-0000-000000000001', '影刃匕首', 'weapon_1', true),
  ('bbbbbbbb-0002-0000-0000-000000000001', 'dddddddd-0005-0000-0000-000000000001', '暗影轻甲', 'armor_chest', true)
ON CONFLICT (npc_id, slot_type) DO NOTHING;

-- ── 13. Player Fields ────────────────────────────────────────────────────
-- NOTE: hp/mp 不在此定义 — 由 player_core_stats 表独占管理（Node 11 精确计算）。
-- 在 world_player_fields 中重复定义 hp/mp 会导致：
--   1. 前端 info bar 重复显示
--   2. Node 7 LLM 误更新 dynamic_fields.hp 导致数值不一致
--   3. 死亡检查读错数据源
INSERT INTO world_player_fields (id, world_id, field_name, field_type, default_value, is_hidden, display_order)
VALUES
  ('aabbccdd-0003-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   '状态', 'text', '正常', false, 0)
ON CONFLICT (id) DO UPDATE
  SET field_name = EXCLUDED.field_name,
      default_value = EXCLUDED.default_value,
      display_order = EXCLUDED.display_order;

-- Clean up legacy hp/mp entries if they exist from previous seeds
DELETE FROM world_player_fields
WHERE world_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  AND field_name IN ('hp', 'mp');

-- ── Verify ───────────────────────────────────────────────────────────────
SELECT 'World'  AS type, id::text, name FROM worlds      WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'
UNION ALL
SELECT 'Quest',  id::text, title       FROM quests       WHERE world_id = 'aaaaaaaa-0000-0000-0000-000000000001'
UNION ALL
SELECT 'Node',   id::text, name        FROM story_nodes  WHERE world_id = 'aaaaaaaa-0000-0000-0000-000000000001'
UNION ALL
SELECT 'Edge',   id::text, edge_type   FROM story_edges  WHERE world_id = 'aaaaaaaa-0000-0000-0000-000000000001'
UNION ALL
SELECT 'NPC',    id::text, name        FROM npcs         WHERE world_id = 'aaaaaaaa-0000-0000-0000-000000000001'
UNION ALL
SELECT 'Item',   id::text, name || ' (' || COALESCE(item_stats->>'type','?') || ')'
  FROM items WHERE world_id = 'aaaaaaaa-0000-0000-0000-000000000001'
UNION ALL
SELECT 'Ability', id::text, name || ' (dmg:' || COALESCE(ability_stats->>'damage','0') || ')'
  FROM abilities WHERE world_id = 'aaaaaaaa-0000-0000-0000-000000000001'
UNION ALL
SELECT 'NPC Equip', ne.slot_type, ne.item_name
  FROM npc_equipment ne
  JOIN npcs n ON n.id = ne.npc_id
  WHERE n.world_id = 'aaaaaaaa-0000-0000-0000-000000000001'
UNION ALL
SELECT 'Rule',   id::text, name        FROM rules        WHERE world_id = 'aaaaaaaa-0000-0000-0000-000000000001'
UNION ALL
SELECT 'Loc',    id::text, name        FROM locations    WHERE world_id = 'aaaaaaaa-0000-0000-0000-000000000001';
