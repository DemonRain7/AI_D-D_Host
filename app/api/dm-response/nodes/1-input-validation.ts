/**
 * NODE 1: Input Validation
 * Validates incoming request data
 */

export type InputValidationInput = {
  sessionId: string | undefined
  playerMessage: string | undefined
}

export type InputValidationOutput = {
  sessionId: string
  playerMessage: string
}

export async function validateInput(
  input: InputValidationInput
): Promise<InputValidationOutput> {
  const { sessionId, playerMessage } = input

  if (!sessionId || !playerMessage) {
    throw new Error('Missing sessionId or playerMessage')
  }

  return {
    sessionId,
    playerMessage,
  }
}
