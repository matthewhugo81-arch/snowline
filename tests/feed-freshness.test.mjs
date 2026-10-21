import test from 'node:test';
import assert from 'node:assert/strict';
import {feedFreshness} from '../map-feed-freshness.js';
test('readable but indefinitely old data cannot be reported as current',()=>{
 const uk={id:'ukmo_uk_deterministic_2km'};
 assert.equal(feedFreshness(uk,5).state,'current');
 assert.equal(feedFreshness(uk,7).state,'review');
 assert.equal(feedFreshness(uk,13).state,'overdue');
 assert.equal(feedFreshness({id:'global'},49).state,'overdue');
 assert.equal(feedFreshness({id:'regional',regional:true},25).state,'overdue');
 assert.equal(feedFreshness(uk,-1).state,'invalid');
});
