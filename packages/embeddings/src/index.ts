export function getEmbedding(text: string): number[] {
  // trivial deterministic stub for testing imports
  return Array.from(text).map((c) => c.charCodeAt(0) % 10);
}

export default getEmbedding;