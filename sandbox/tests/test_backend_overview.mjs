import test from 'node:test';
import assert from 'node:assert/strict';
import {isBackendReplay,metricText,savedMonthValue,backendBuildingLabels} from '../web/backend-overview.js';

test('only narrative display states receive backend semantics',()=>{
 assert.equal(isBackendReplay({world:{version:'narrative-display-1'}}),true);
 for(const value of [null,{}, {world:{version:'legacy'}}])assert.equal(isBackendReplay(value),false);
});
test('missing metrics remain unavailable while a real zero remains zero',()=>{
 for(const value of [null,undefined,NaN,Infinity,'0'])assert.equal(metricText(value),'Not modeled');
 assert.equal(metricText(0),'0');assert.equal(metricText(25000,v=>`${v} resident places`),'25000 resident places');
});
test('cross-year source dates map to actual cumulative timeline values',()=>{
 const exported={monthlyStates:[{month:'2024-11-30'},{month:'2024-12-30'},{month:'2025-01-30'},{month:'2025-02-28'}]};
 const state={timeline:[10,11,12,13].map(month=>({month}))};
 assert.equal(savedMonthValue(state,exported,'2025-01-30'),12);assert.equal(savedMonthValue(state,exported,'2025-02-28'),13);
});
test('missing source date or mismatched timeline cannot silently seek another month',()=>{
 const exported={monthlyStates:[{month:'2025-01-01'}]};
 assert.throws(()=>savedMonthValue({timeline:[]},exported,'2025-01-01'),/matching/);
 assert.throws(()=>savedMonthValue({timeline:[{month:0}]},exported,'2025-02-01'),/matching/);
 assert.throws(()=>savedMonthValue({timeline:[{month:'0'}]},exported,'2025-01-01'),/matching/);
});
test('housing cluster labels distinguish planned from available resident places',()=>{
 assert.equal(backendBuildingLabels({kind:'housing',progress:.5}).capacity,'Planned resident places');
 assert.equal(backendBuildingLabels({kind:'housing',progress:1}).capacity,'Resident places');
 assert.match(backendBuildingLabels({kind:'housing'}).name,/cluster/);
});
test('business capacity is offered jobs and parks/stations have no invented count',()=>{
 assert.equal(backendBuildingLabels({kind:'office',progress:1}).capacity,'Offered job capacity');
 for(const kind of ['park','transit'])assert.equal(backendBuildingLabels({kind}).capacity,null);
});
