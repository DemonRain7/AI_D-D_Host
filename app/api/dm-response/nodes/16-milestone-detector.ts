/**
 * NODE 16: Milestone Detector (重大事件检测)
 *
 * Runs after narrative generation (fire-and-forget, non-blocking).
 * Uses a 5-dimension scoring rubric to judge whether this turn
 * deserves to be recorded as a story milestone.
 *
 * Scoring dimensions (max 100 total):
 *   plot_impact          0–30   剧情影响力：主线推进、NPC关系重大变化、世界级发现
 *   conflict_intensity   0–20   战斗/冲突烈度：BOSS击败、队员死亡、关键失败/成功
 *   acquisition          0–20   获得/失去：传说物品、新能力；永久失去重要资产
 *   moral_weight         0–15   道德重量：重大抉择、背叛、不可逆的道德后果
 *   narrative_uniqueness 0–15   叙事独特性：首次接触重要元素、令人难忘的场景
 *
 * Threshold: total >= 40 → write to session_milestones table.
 *
 * Fallback: silently skip on any error (milestone recording is optional).
 */

import OpenAI from 'openai'
import { SupabaseClient } from '@supabase/supabase-js'
import type { OutcomeSynthesis } from '../types/game-mechanics'
import type { IntentClassification } from '../types/intent'
import { MODEL_FAST } from '@/lib/config'

// ── Types ─────────────────────────────────────────────────────────────────

export type MilestoneEventType =
  | 'COMBAT_VICTORY'
  | 'COMBAT_DEFEAT'
  | 'MAJOR_DISCOVERY'
  | 'ALLIANCE_FORMED'
  | 'BETRAYAL'
  | 'QUEST_COMPLETE'
  | 'ITEM_ACQUIRED'
  | 'ABILITY_GAINED'
  | 'CHARACTER_DEATH'
  | 'WORLD_CHANGE'
  | 'MORAL_CHOICE'
  | 'OTHER'

export type MilestoneScoreBreakdown = {
  plot_impact: number          // 0–30
  conflict_intensity: number   // 0–20
  acquisition: number          // 0–20
  moral_weight: number         // 0–15
  narrative_uniqueness: number // 0–15
  reasoning: string
  event_summary: string        // Non-empty only when total >= threshold
  event_type: MilestoneEventType
}

export type MilestoneDetectorInput = {
  sessionId: string
  playerId: string | null
  playerMessage: string
  dmResponse: string
  intent: IntentClassification
  outcome: OutcomeSynthesis
  turnNumber?: number
  supabase: SupabaseClient
  openai: OpenAI
}

// ── Constants ─────────────────────────────────────────────────────────────

const MILESTONE_THRESHOLD = 40

// ── Scoring Tool Definition ───────────────────────────────────────────────

const SCORE_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'score_event_significance',
    description: 'Score whether this TTRPG turn is a significant story milestone worth recording.',
    parameters: {
      type: 'object',
      required: [
        'plot_impact',
        'conflict_intensity',
        'acquisition',
        'moral_weight',
        'narrative_uniqueness',
        'reasoning',
        'event_summary',
        'event_type',
      ],
      properties: {
        plot_impact: {
          type: 'number',
          description:
            '0–30. Degree of impact on main plot or world state. ' +
            '0 = no plot relevance at all. ' +
            '5 = minor flavor moment. ' +
            '10 = subplot advanced or minor NPC relationship changed. ' +
            '20 = major story beat, important NPC dead/allied/betrayed. ' +
            '30 = world-altering event (a kingdom falls, a god is slain, fate of the world changes).',
        },
        conflict_intensity: {
          type: 'number',
          description:
            '0–20. Severity of combat or conflict this turn. ' +
            '0 = no combat, pure narrative. ' +
            '5 = routine minor enemy defeated. ' +
            '12 = named villain or boss-level enemy defeated; or party member gravely endangered. ' +
            '20 = PC dies, entire party wiped, or catastrophic irreversible combat outcome.',
        },
        acquisition: {
          type: 'number',
          description:
            '0–20. Weight of significant gains or permanent losses this turn. ' +
            '0 = nothing gained or lost. ' +
            '5 = common item or minor clue found. ' +
            '12 = rare/legendary item, new spell or ability learned, important information obtained. ' +
            '20 = game-changing artifact found or used; OR permanent loss of key item, ability, or beloved NPC.',
        },
        moral_weight: {
          type: 'number',
          description:
            '0–15. Moral or ethical significance of the player\'s choice this turn. ' +
            '0 = morally neutral routine action. ' +
            '5 = a minor ethical crossroads with limited consequence. ' +
            '10 = significant betrayal, sacrifice, or choice with lasting character consequences. ' +
            '15 = an irreversible, world-moral consequence (genocide, freeing a demon, sacrificing innocents).',
        },
        narrative_uniqueness: {
          type: 'number',
          description:
            '0–15. How memorable or narratively unique this moment is. ' +
            '0 = completely routine, forgettable. ' +
            '5 = slightly interesting but typical for this genre. ' +
            '10 = a memorable scene the player will likely recall later. ' +
            '15 = a defining moment — the kind of story beat that gets retold ("remember when we found that...").',
        },
        reasoning: {
          type: 'string',
          description:
            'Brief 1–2 sentence explanation of why you gave these scores. Be specific about what happened.',
        },
        event_summary: {
          type: 'string',
          description:
            'If total score >= 40: write a concise, vivid 1–2 sentence story summary for the chronicle. ' +
            'Written in past tense, third person. Example: "The party discovered the Tomb of the Ancient Lich beneath the tavern cellar." ' +
            'If total < 40, return empty string "".',
        },
        event_type: {
          type: 'string',
          enum: [
            'COMBAT_VICTORY',
            'COMBAT_DEFEAT',
            'MAJOR_DISCOVERY',
            'ALLIANCE_FORMED',
            'BETRAYAL',
            'QUEST_COMPLETE',
            'ITEM_ACQUIRED',
            'ABILITY_GAINED',
            'CHARACTER_DEATH',
            'WORLD_CHANGE',
            'MORAL_CHOICE',
            'OTHER',
          ],
          description:
            'Category that best describes this milestone. Only meaningful when total >= 40. ' +
            'Use MAJOR_DISCOVERY for finding important items/places/lore. ' +
            'Use WORLD_CHANGE for events that alter the game world permanently.',
        },
      },
    },
  },
}

// ── System Prompt ─────────────────────────────────────────────────────────

const DETECTION_SYSTEM_PROMPT = `You are a TTRPG chronicle keeper. Your job is to evaluate each game turn and decide if it deserves to be permanently recorded as a story milestone.

BE STRICT. Most turns are NOT milestones. Only truly significant story beats should be recorded.

SCORING EXAMPLES (for calibration):

❌ NOT milestones (total < 40):
  - "I go to the bathroom"          → 0+0+0+0+0 = 0
  - "I walk to the next room"       → 2+0+0+0+0 = 2
  - "I talk to the innkeeper"       → 3+0+0+0+2 = 5
  - "I attack the goblin" (routine) → 3+5+0+0+0 = 8
  - "I buy a healing potion"        → 0+0+5+0+0 = 5
  - "I examine the statue"          → 5+0+0+0+5 = 10

✅ ARE milestones (total ≥ 40):
  - Finding a legendary artifact while doing something mundane:
    → plot:20 + conflict:0 + acquisition:20 + moral:0 + unique:15 = 55
  - Killing the main villain:
    → plot:30 + conflict:20 + acquisition:5 + moral:0 + unique:15 = 70
  - Betraying the party to join the antagonist:
    → plot:25 + conflict:0 + acquisition:0 + moral:15 + unique:10 = 50
  - Discovering the ancient prophecy that ties everything together:
    → plot:25 + conflict:0 + acquisition:12 + moral:0 + unique:15 = 52
  - A party member dying in a dramatic last stand:
    → plot:15 + conflict:20 + acquisition:0 + moral:10 + unique:15 = 60
  - Using a world-altering artifact for the first time:
    → plot:30 + conflict:10 + acquisition:5 + moral:10 + unique:15 = 70

When in doubt, score lower rather than higher. A session should have maybe 3–10 milestones total, not 30.`

// ── Main Function ─────────────────────────────────────────────────────────

/**
 * Evaluates whether this turn is a significant story milestone.
 * If yes, writes it to session_milestones.
 * Always resolves without throwing (silently fails on error).
 */
export async function detectMilestone(input: MilestoneDetectorInput): Promise<void> {
  const {
    sessionId,
    playerId,
    playerMessage,
    dmResponse,
    intent,
    outcome,
    turnNumber,
    supabase,
    openai,
  } = input

  try {
    const effectsText =
      outcome.mechanicalEffects.length > 0
        ? outcome.mechanicalEffects.map(e => e.reason).join('; ')
        : 'none'

    const userContent =
      `PLAYER ACTION: ${playerMessage}\n` +
      `INTENT TYPE: ${intent.intent}\n` +
      `OUTCOME: ${outcome.outcome}\n` +
      `MECHANICAL EFFECTS: ${effectsText}\n` +
      `DM RESPONSE (excerpt): ${dmResponse.slice(0, 500)}`

    const response = await openai.chat.completions.create({
      model: MODEL_FAST,
      messages: [
        { role: 'system', content: DETECTION_SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      tools: [SCORE_TOOL],
      tool_choice: { type: 'function', function: { name: 'score_event_significance' } },
    })

    const toolCall = response.choices[0]?.message?.tool_calls?.[0]
    if (!toolCall || !('function' in toolCall) || !toolCall.function?.arguments) {
      console.warn('[Node 16 · Milestone] 未返回工具调用，跳过')
      return
    }

    const scores: MilestoneScoreBreakdown = JSON.parse(toolCall.function.arguments)
    const total =
      scores.plot_impact +
      scores.conflict_intensity +
      scores.acquisition +
      scores.moral_weight +
      scores.narrative_uniqueness

    const clampedTotal = Math.max(0, Math.min(100, total))
    const isSignificant = clampedTotal >= MILESTONE_THRESHOLD && scores.event_summary.length > 0

    console.log(
      `[Node 16 · Milestone] 评分: ${clampedTotal}/100` +
      ` (plot:${scores.plot_impact} conflict:${scores.conflict_intensity}` +
      ` acquire:${scores.acquisition} moral:${scores.moral_weight}` +
      ` unique:${scores.narrative_uniqueness})` +
      ` — ${isSignificant ? '✅ 记录里程碑' : '❌ 跳过'}`
    )
    if (isSignificant) {
      console.log(`[Node 16 · Milestone] "${scores.event_summary}" [${scores.event_type}]`)
    }

    if (!isSignificant) return

    const { error } = await supabase.from('session_milestones').insert({
      session_id: sessionId,
      player_id: playerId,
      turn_number: turnNumber ?? null,
      event_summary: scores.event_summary,
      event_type: scores.event_type,
      total_score: clampedTotal,
      score_breakdown: {
        plot_impact: scores.plot_impact,
        conflict_intensity: scores.conflict_intensity,
        acquisition: scores.acquisition,
        moral_weight: scores.moral_weight,
        narrative_uniqueness: scores.narrative_uniqueness,
        reasoning: scores.reasoning,
      },
      player_message: playerMessage,
      outcome_type: outcome.outcome,
    })

    if (error) {
      console.error('[Node 16 · Milestone] 数据库写入失败:', error.message)
    }
  } catch (error) {
    // Non-fatal: milestone recording is optional
    console.error('[Node 16 · Milestone] 出错（非致命）:', error)
  }
}
