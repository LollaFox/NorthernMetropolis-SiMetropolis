// Visual interpolation only. Never alters canonical construction progress.
export const REPLAY_TRANSITION_SECONDS=.65;
export function startReplayTransition(record,target,reducedMotion=false){
 record.target=target;
 if(reducedMotion||Math.abs(record.progress-target)<.002){record.progress=target;delete record.replayTransition;return;}
 record.replayTransition={from:record.progress,elapsed:0};
}
export function advanceConstruction(record,dt,playing,reducedMotion=false){
 const before=record.progress;
 if(record.replayTransition){
  const transition=record.replayTransition;transition.elapsed+=Math.max(0,Number.isFinite(dt)?dt:0);
  const t=reducedMotion?1:Math.min(1,transition.elapsed/REPLAY_TRANSITION_SECONDS),ease=t*t*(3-2*t);
  record.progress=transition.from+(record.target-transition.from)*ease;
  if(t===1){record.progress=record.target;delete record.replayTransition;}
 }else if(Math.abs(record.progress-record.target)>.002){record.progress=playing?before+(record.target-before)*(1-Math.exp(-Math.max(0,dt)*4)):record.target;}
 return record.progress!==before;
}
