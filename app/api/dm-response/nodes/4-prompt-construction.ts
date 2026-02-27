/**
 * NODE 4: Prompt Construction
 * Constructs the final prompt from context sections
 */

import { ContextAssemblyOutput } from './3-context-assembly'
import { DM_GUIDELINES } from '../prompts'
import type { StoryNodeSummary } from './3e-story-state-loader'

export type PromptConstructionInput = {
  contextSections: ContextAssemblyOutput
  playerMessage: string
  activeEndingNode?: StoryNodeSummary | null
  combatModeDirective?: string
}

export type PromptConstructionOutput = {
  userPrompt: string
}

const OUTCOME_NARRATION_DIRECTIVE = `
IMPORTANT: A "MECHANICAL OUTCOME" section appears above. The dice have already been rolled and the result is FINAL.
Your job is ONLY to narrate this predetermined outcome in an engaging, immersive way.
DO NOT re-decide whether the action succeeds or fails — that decision is already made.
DO NOT invent new mechanical effects beyond what is listed.
Focus on vivid, atmospheric storytelling that brings the outcome to life.`

/**
 * Constructs the final user prompt from all context sections
 */
/**
 * Builds a special ending directive for the DM when an ending node is active.
 * The DM must produce a conclusive, world-appropriate ending scene.
 */
function buildEndingDirective(endingNode: StoryNodeSummary): string {
  const scriptSection = endingNode.ending_script
    ? `\n\n结局台本（必须以此为核心展开）：\n${endingNode.ending_script}`
    : ''
  return `

━━━ 本回合为故事终章（最高优先级，覆盖以上所有长度指令） ━━━
当前故事已到达终章节点「${endingNode.name}」。
节点描述：${endingNode.description}${scriptSection}

你的任务：
1. 以1段话交代本轮玩家行动的直接后果。
2. 以结局台本（如有）为核心，用3-5段壮阔、有余韵的文字写出故事的最终收场，体现玩家这段旅途中选择与行动的重量。
3. 语气庄重而克制——不要煽情，让事实与细节说话。
4. 绝不描述任何新的可交互对象。绝不暗示玩家"还可以继续行动"。以一个完全封闭的、令人回味的句子作结。`
}

export async function constructPrompt(
  input: PromptConstructionInput
): Promise<PromptConstructionOutput> {
  const { contextSections, playerMessage, activeEndingNode, combatModeDirective } = input

  const {
    worldSettingContext,
    itemsContext,
    locationsContext,
    abilitiesContext,
    organizationsContext,
    taxonomiesContext,
    rulesContext,
    npcsContext,
    playerFieldsContext,
    playerContext,
    conversationalContext,
    milestonesContext,
    scenarioEventContext,
    mechanicsContext,
    storyContext,
    equipmentContext,
    combatLootContext,
  } = contextSections

  const hasMechanics = mechanicsContext && mechanicsContext.trim().length > 0
  const narratorDirective = hasMechanics ? OUTCOME_NARRATION_DIRECTIVE : ''
  const combatDirective = combatModeDirective ?? ''
  const endingDirective = activeEndingNode ? buildEndingDirective(activeEndingNode) : ''

  const isGameStart = playerMessage === '__GAME_START__'

  // Special instruction block for game start vs normal turns
  const playerActionSection = isGameStart
    ? `GAME START DIRECTIVE:
This is the very first moment of the game. The player has just entered the world.
Do NOT treat "__GAME_START__" as a player action. Instead, write the opening scene:
- Begin with 1–2 sentences that establish the immediate atmosphere and the player's physical situation.
- Then describe the environment in rich sensory detail across 2–4 paragraphs: what can be seen near and far, heard, smelled, felt (temperature, texture, wind). Make the world feel vivid and real.
- Introduce at least 2 things already in motion: an NPC doing something, a sound in the distance, an object of interest, an ongoing event — things that make the world feel alive before the player acts.
- End the scene at a natural moment where the player finds themselves with several things to observe or approach, without ever listing them as choices.
Do not greet the player. Do not explain that this is a game. Simply begin narrating.`
    : `Player Action: "${playerMessage}"`

  // Assemble the user prompt by concatenating all context sections.
  // Order: world → entities → player → conversation → milestones → story state → scenario event → dice outcome → guidelines
  const userPrompt = `You are the Dungeon Master for a TTRPG game. Here is the world background and context:

${worldSettingContext}${itemsContext}${locationsContext}${abilitiesContext}${organizationsContext}${taxonomiesContext}${rulesContext}${npcsContext}${playerFieldsContext}${playerContext}${equipmentContext}${conversationalContext}${milestonesContext}${storyContext}${scenarioEventContext}${mechanicsContext}${combatLootContext}
${DM_GUIDELINES}${narratorDirective}${combatDirective}${endingDirective}

${playerActionSection}

DM Response:`

  return {
    userPrompt,
  }
}
