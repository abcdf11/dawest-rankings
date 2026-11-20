import { describe, expect, it } from 'vitest';
import { demo } from './api';
import { simulateLocal, tierForRating } from './rating';
import { decodeRanking, movePlayer } from './builder';
describe('shared rating behavior', () => {
  const [a, b] = demo.players;
  it('conserves points and never modifies the ladder', () => {
    const before = JSON.stringify(demo.players);
    const result = simulateLocal(demo.players, a.id, b.id, 5, 2, 'TOURNAMENT');
    expect(result.delta_a + result.delta_b).toBe(0);
    expect(result.rating_a + result.rating_b).toBeCloseTo(a.rating+b.rating, 8);
    expect(JSON.stringify(demo.players)).toBe(before);
  });
  it('agrees with the Python formula for a golden vector', () => {
    const players = [{...a, rating: 1500}, {...b, rating: 1500}];
    expect(simulateLocal(players, a.id, b.id, 5, 2, 'RANKED_1V1').delta_a).toBe(23.76);
  });
  it('handles tier boundaries and invalid input', () => {
    expect([1299.99,1300,1500,1700,1900].map(tierForRating)).toEqual(['ROOKIE','DEPUTY','GUNSLINGER','OUTLAW','LEGEND']);
    expect(() => simulateLocal(demo.players,a.id,a.id,5,2,'RANKED_1V1')).toThrow();
    expect(() => simulateLocal(demo.players,a.id,b.id,2,2,'RANKED_1V1')).toThrow();
    expect(() => simulateLocal(demo.players,a.id,b.id,-1,2,'RANKED_1V1')).toThrow();
  });
});
describe('community share links', () => {
  it('rejects duplicate, unknown, malformed and excessive IDs', () => {
    expect(decodeRanking('#list=1.2.3',[1,2,3])).toEqual([1,2,3]);
    for (const hash of ['#list=1.1','#list=1.99','#list=garbage','#list=']) expect(decodeRanking(hash,[1,2,3])).toBeNull();
  });
  it('moves one player without mutating the input', () => {
    const ids = [1,2,3]; expect(movePlayer(ids,0,2)).toEqual([2,3,1]); expect(ids).toEqual([1,2,3]);
  });
});
