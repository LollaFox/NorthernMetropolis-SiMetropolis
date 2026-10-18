# Sandbox v2 interface contract
Version 2.0 / lead-owned / 2026-09-30
Local internal. Original software is covered by the repository LICENSE (SiMetropolis Decision Sandbox Restricted License). Reviewed v2 is the primary sandbox/ package; original v1 is preserved unchanged in sandbox_v1/. The relative sandbox_v2 -> sandbox compatibility symlink supports existing v2 commands. Canonical launch: python3 sandbox/server.py --port 8877 or python3 -m sandbox.server --port 8877. Existing provider transport is imported from sandbox_v1/ without changing its configuration loader.
## Python world
sandbox/engine.py functions: create_world(seed=42), step_world(world, decisions=None), intervene(world, text, kind=None), validate_world(world), actor_packet(world, actor_id).
All pure, deepcopy input, deterministic with seed+month; no provider I/O. ValidationError(ValueError).
step_world advances exactly 1 month; no terminal scripted year. intervene applies an affordable validated action or records an unrecognized proposal explicitly, never silently claims unsupported text executed.
World keys: version:"2.0.0",seed:int,month:int,year:int,buildings:list,metrics:dict,policies:dict,actors:list,messages:list,events:list,objectives:list,ledger:list.
metrics keys: population,jobs,homes,happiness(0..100),airQuality(0..100),emissions(tCO2e/month),treasuryM,businessCashM,powerDemand,powerCapacity.
buildings: {id,kind,x,z,height,progress(0..1),capacity,owner,createdMonth}. kind one of housing,office,industry,park,solar,transit,civic. Coordinates on an x/z city grid within -48..48, exclude river x~15..24. Height in world units. Initial populated scene ~35-55 buildings with room to grow. Construction increments during step, benefits only when progress=1. World size finite but upgrades/redevelopment continue.
policies: {housing,transit,green,business,taxRate}; all finite documented scales.
actors IDs: government,business,residents,energy. Actor {id,name,role,cashM,mood,stance}.
messages: {id,month,source,text,action,sourceType}, sourceType rules|live|user. bounded recent retention, snapshot history held by service.
events: {id,month,type,title,detail,x,z}. goals/objectives {id,label,current,target,achieved}.
Decisions: list of {actor,action,reason,message,sourceType}; allowed action wait,build_housing,build_office,build_industry,build_park,build_solar,build_transit,subsidize_housing,support_business,raise_tax,lower_tax. Roles must have restricted allowed actions, validate proposals at current state. Engine knows costs and quantities, models choose only actions. No model-generated numbers trusted.
actor_packet returns actor's goal/state, public model facts, recent attributed messages from others, user proposals, and allowedActions; future info never passed.
## HTTP / UI
Python stdlib server default loopback port 8877, same origin static. No build tooling.
GET /api/state -> envelope:
{id,label,parentId,world,playing,speed,mode,ai,timeline,branches,viewingMonth}
mode rules|live; ai {available,provider,model,status,requests,limit,errors,lastError}; timeline [{month,population,buildings,happiness}]; branches [{id,label,month,parentId}]; viewingMonth null at present else selected month.
POST /api/control {playing?:boolean,speed?:number} speeds 0.5,1,2,4,8. Base month every 1.6s. Speed affects simulation only; camera animates separately.
POST /api/intervention {text:string,kind?:string} -> envelope (intervene at viewed historical month automatically creates independent branch).
POST /api/seek {month:int} -> envelope, pauses, returns exact saved world. GET timeline includes all saved months. Resuming from history automatically branches.
POST /api/branch {month?:int,label?:string} -> envelope, forks immutable prefix.
POST /api/switch {id:string} -> envelope, pauses and switches branch.
POST /api/reset {seed?:int} -> envelope new branch, retain existing ones.
POST /api/mode {mode:"rules"|"live"} -> envelope. Live requires existing configured provider. Default rules. Never silently label fallback as live.
GET /api/export -> versioned JSON download including snapshot history. Persistence writes local ignored sandbox/.data/city.json via atomic replace; server restart restores paused.
GET /api/model -> equations/assumptions/costs/action bounds. Compact synthetic-status explanation accessible from UI.
Errors JSON {error:string} non-2xx, state unchanged.
UI polling ~450ms; actions immediate. No backend private errors or keys in browser.
Live AI off-thread: math clock never waits on network. Four roles, bounded actor packets and structured 768-token outputs, 8192-byte serialized max; provider failures explicitly recorded. Stale branch or changed policy proposals discarded; arithmetic validates affordability upon apply. Limit provider calls per session, visible user status.
## Product/design
A real freely orbitable 3D city, original geometry, roads/river/mountains/greenery, traffic, construction interpolation, alive day lighting. Three.js 0.180.0 local MIT vendor. Primary world fills screen, future-focused calm dark control surfaces over luminous city; avoid dashboard dominating.
Timeline play/pause/speed/rewind, branch selector, input policies anytime, clickable buildings with inspector, mission objectives with milestones, city heat layers (city/housing/mobility/climate), concise actor activity drawer and model transparency drawer. Keyboard/mouse support and responsive layout. Display synthetic scenario / model-based projection, not calibrated forecast.
## Acceptance
Determinism, resource bounds, construction time, action validation, autonomous changes, meaningful policy differences, exact rewind, branch isolation, persistence, bounded live packets, role isolation, async network does not block input, stale results discarded, provider error provenance, API errors, browser actual WebGL, responsive controls and no console errors. Real provider smoke <=6 calls separately approved; no paid calls in regular tests.
