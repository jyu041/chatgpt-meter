export type OptionalThreshold = number | null;

export function thresholdReached(value: number, threshold: OptionalThreshold): boolean {
  return threshold !== null && value >= threshold;
}
