/**
 * NPC Agent System — Type Definitions
 *
 * Types for NPC independent decision-making, memory persistence,
 * and action generation.
 */

export type NPCMemory = {
  npcId: string
  npcName: string
  memories: string[]
  attitude: string     // friendly / hostile / neutral / afraid / respectful
  status: string       // alive / dead / fled / allied
  lastSeenTurn: number
}

export type NPCAction = {
  npcId: string
  npcName: string
  action: string           // e.g. "奥斯卡走上裁判席，准备宣布比赛结果"
  dialogue: string | null  // e.g. "你的表现令我刮目相看" or null
  attitudeShift: string | null  // e.g. "friendly" or null (no change)
}

export type NPCMemoryUpdate = {
  npcId: string
  newMemory: string | null      // new memory entry, null = no update
  attitudeShift: string | null
  statusChange: string | null
}

export const EMPTY_NPC_MEMORIES: NPCMemory[] = []
