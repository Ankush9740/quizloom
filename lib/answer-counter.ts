export type AnswerCounterBucket = { bucket: number; count: number };

function validBucket(value: AnswerCounterBucket): boolean {
  return Number.isInteger(value.bucket) && value.bucket >= 0 && value.bucket < 16 && Number.isInteger(value.count) && value.count >= 0;
}

export function mergeAnswerCounterBuckets(
  current: AnswerCounterBucket[] = [],
  incoming: AnswerCounterBucket[] = []
): { buckets: AnswerCounterBucket[]; total: number } {
  const merged = new Map<number, number>();
  for (const value of [...current, ...incoming]) {
    if (!validBucket(value)) continue;
    merged.set(value.bucket, Math.max(merged.get(value.bucket) ?? 0, value.count));
  }
  const buckets = [...merged].map(([bucket, count]) => ({ bucket, count })).sort((a, b) => a.bucket - b.bucket);
  return { buckets, total: buckets.reduce((sum, value) => sum + value.count, 0) };
}
