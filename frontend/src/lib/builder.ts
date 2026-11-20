export function decodeRanking(hash: string, validIds: number[]): number[] | null {
  const value = new URLSearchParams(hash.replace(/^#/, '')).get('list');
  if (!value || value.length > 500) return null;
  const ids = value.split('.').map(Number);
  if (!ids.length || ids.length > 20 || ids.some(id => !Number.isInteger(id) || !validIds.includes(id)) || new Set(ids).size !== ids.length) return null;
  return ids;
}
export function movePlayer(ids: number[], from: number, to: number) { const next = [...ids]; if (from < 0 || to < 0 || from >= ids.length || to >= ids.length) return next; const [id] = next.splice(from, 1); next.splice(to, 0, id); return next; }
