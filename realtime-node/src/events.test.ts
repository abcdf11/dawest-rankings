import assert from 'node:assert/strict';
import test from 'node:test';
import { liveEvent, rankingEvent } from './events.js';
test('accepts a committed ranking event and rejects missing revision', () => {
  const event = { event_id: 4, revision: 3, match_id: 2, updated_at: new Date().toISOString(), players: [{id: 1,rating: 1600,rank: 2}] };
  assert.equal(rankingEvent.safeParse(event).success, true);
  assert.equal(rankingEvent.safeParse({...event,revision:undefined}).success, false);
});
test('rejects invalid live scores and unbounded player names', () => {
  const event = {event_id:1,match_id:1,event:'Open',player_a:'Deadeye',player_b:'Vex',score_a:5,score_b:2,status:'LIVE'};
  assert.equal(liveEvent.safeParse(event).success,true);
  assert.equal(liveEvent.safeParse({...event,score_a:-1}).success,false);
  assert.equal(liveEvent.safeParse({...event,player_a:'x'.repeat(65)}).success,false);
});
