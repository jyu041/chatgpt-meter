export interface LimitObservation {
  conversationId: string;
  measuredAt: string;
  historicalTokensEstimate: number;
  structuralPressureRaw: number;
  activeBranchMessages: number;
}

export const MAX_LIMIT_OBSERVATIONS = 100;

export function upsertLimitObservation(
  observations: LimitObservation[],
  observation: LimitObservation,
): LimitObservation[] {
  const withoutConversation = observations.filter(
    (item) => item && item.conversationId !== observation.conversationId,
  );
  return [...withoutConversation, observation].slice(-MAX_LIMIT_OBSERVATIONS);
}
