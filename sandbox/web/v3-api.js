import {reviewResponse, runResponse, snapshotResponse, validateSetup, validatePDF} from './v3-contract.js';

export class HttpTransport {
  constructor(fetcher=(...args)=>globalThis.fetch(...args), timeout=30000) { this.fetcher=fetcher; this.timeout=timeout; }
  async request(path, body, signal, key, extraHeaders) {
    const controller=new AbortController(), abort=()=>controller.abort();
    signal?.addEventListener('abort',abort,{once:true}); if(signal?.aborted) controller.abort();
    const timer=setTimeout(abort,this.timeout);
    try {
      const isForm=body instanceof FormData;
      const response=await this.fetcher(`/api/v3${path}`,{method:body===undefined?'GET':'POST',body:body===undefined?undefined:isForm?body:JSON.stringify(body),headers:{...(isForm||body===undefined?{}:{'Content-Type':'application/json'}),...(key?{'Idempotency-Key':key}:{}),...(extraHeaders||{})},signal:controller.signal,cache:'no-store'});
      const type=response.headers.get('content-type')||'';
      if(!type.includes('application/json')) throw new Error(`Expected JSON; server returned HTTP ${response.status}.`);
      const data=await response.json();
      if(!response.ok) {const error=new Error(typeof data.error==='string'?data.error:`Backend request failed (${response.status}).`);error.httpStatus=response.status;error.recoverable=data.recoverable===true;throw error;}
      return data;
    } catch(e) {if(controller.signal.aborted) throw new Error('Request stopped or timed out.'); throw e;}
    finally {clearTimeout(timer); signal?.removeEventListener('abort',abort);}
  }
}
const id=value=>encodeURIComponent(value);
const clone=value=>value===undefined?null:JSON.parse(JSON.stringify(value));
const SESSION_SCHEMA='nm-v3-session-v1';
const STATES=['draft','initializing','review','confirming','confirmed','running','ready'];
const OPERATIONS=['initialize','confirm','simulate'];
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value);
const assertLive=signal=>{if(signal?.aborted)throw new Error('Waiting stopped.');};
const wait=(ms,signal)=>new Promise((resolve,reject)=>{
  const stop=()=>{clearTimeout(timer);reject(new Error('Stopped waiting.'));};
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',stop);resolve();},ms);
  if(signal?.aborted) stop(); else signal?.addEventListener('abort',stop,{once:true});
});
export class V3Session {
  constructor(transport, {today,sleep=wait,key=()=>crypto.randomUUID(),pollLimit=1200,pollInterval=1000,onProgress,onState,storage,storageKey=SESSION_SCHEMA}={}) {
    if(!Number.isInteger(pollLimit)||pollLimit<1||!Number.isFinite(pollInterval)||pollInterval<0)throw new Error('Use a positive polling limit and a non-negative polling interval.');
    this.transport=transport;this.today=today;this.sleep=sleep;this.makeKey=key;this.pollLimit=pollLimit;this.pollInterval=pollInterval;this.onProgress=onProgress;this.onState=onState;this.storage=storage;this.storageKey=storageKey;this.generation=0;this.storageBlocked=false;this.storageError=null;this.clear();
    if(storage)try{const raw=storage.getItem(storageKey);if(raw)this.restoreSnapshot(JSON.parse(raw),false);}catch{this.storageBlocked=true;this.storageError='Saved API session could not be read. Existing browser data is preserved; this session is in memory only.';}
  }
  clear(){this.state='draft';this.busy=false;this.setup=null;this.review=null;this.run=null;this.keys={};this.lastFingerprint=null;this.pending=null;this.job=null;this.progress=null;this.providerMetrics=null;this.lastError=null;this.exportCache=null;this.exportPending=null;}
  reset(){this.controller?.abort();this.generation++;this.clear();this.storageBlocked=false;this.storageError=null;this.notify();}
  get needsFile(){return this.pending?.name==='initialize'&&!this.pending.jobId;}
  serialize(){return clone({schema:SESSION_SCHEMA,state:this.state,busy:this.busy,setup:this.setup,review:this.review,run:this.run,keys:this.keys,lastFingerprint:this.lastFingerprint,pending:this.pending,job:this.job,progress:this.progress,providerMetrics:this.providerMetrics,lastError:this.lastError,needsFile:this.needsFile});}
  restoreSnapshot(snapshot,notify=true){
    if(this.busy)throw new Error('Stop waiting before restoring a different session.');
    const data=clone(snapshot);
    if(!data||data.schema!==SESSION_SCHEMA||!STATES.includes(data.state)||!data.keys||typeof data.keys!=='object')throw new Error('Unsupported saved API session.');
    const setup=data.setup===null?null:validateSetup(data.setup,this.today),review=data.review===null?null:reviewResponse(data.review),run=data.run===null?null:runResponse(data.run,setup);
    const keys={};for(const name of OPERATIONS)if(data.keys[name]!==undefined){if(!validId(data.keys[name]))throw new Error('Invalid saved operation key.');keys[name]=data.keys[name];}
    const pending=data.pending??null;
    if(pending&&(!OPERATIONS.includes(pending.name)||!['posting','polling','failed'].includes(pending.phase)||(pending.jobId!==null&&!validId(pending.jobId))||!keys[pending.name]))throw new Error('Invalid saved pending operation.');
    if(pending&&!({initialize:['draft','initializing'],confirm:['review','confirming'],simulate:['confirmed','running']}[pending.name].includes(data.state)))throw new Error('Saved operation is incompatible with session state.');
    if(data.job&&(!validId(data.job.jobId)||!['queued','running','complete','failed'].includes(data.job.status)||(pending?.jobId&&data.job.jobId!==pending.jobId)))throw new Error('Invalid saved backend job.');
    if(data.lastFingerprint!==null&&typeof data.lastFingerprint!=='string')throw new Error('Invalid saved initialization fingerprint.');
    if(data.state!=='draft'&&!setup)throw new Error('A restored active session requires its setup.');
    if(['review','confirming','confirmed','running','ready'].includes(data.state)&&!review)throw new Error('A restored reviewed session requires its review.');
    if(data.state==='ready'&&!run)throw new Error('A restored ready session requires its run.');
    for(const [state,name] of [['initializing','initialize'],['confirming','confirm'],['running','simulate']])if(data.state===state&&pending?.name!==name)throw new Error('Saved pending operation does not match session state.');
    this.controller?.abort();this.generation++;this.clear();Object.assign(this,{state:data.state,setup,review,run,keys,lastFingerprint:data.lastFingerprint,pending,job:data.job??null,progress:data.progress??null,providerMetrics:data.providerMetrics??null,lastError:data.lastError??null});
    if(notify)this.notify();return this.serialize();
  }
  notify(){
    const snapshot=this.serialize();
    if(this.storage&&!this.storageBlocked)try{this.storage.setItem(this.storageKey,JSON.stringify(snapshot));this.storageError=null;}catch{this.storageError='API session could not be saved. It remains available in memory; keep this page open.';}
    try{this.onState?.(snapshot);}catch{/* View callbacks must not interrupt a backend operation. */}
  }
  reportJob(data){
    if(!data||typeof data!=='object')throw new Error('Expected a backend response object.');
    if(data.status===undefined)return;
    if(!['queued','running','complete','failed'].includes(data.status))throw new Error('Unknown backend job state.');
    if(data.jobId!==undefined&&!validId(data.jobId))throw new Error('Invalid jobId.');
    if(this.pending?.jobId&&data.jobId&&this.pending.jobId!==data.jobId)throw new Error('Backend returned a different jobId.');
    if(['queued','running'].includes(data.status)&&!validId(data.jobId))throw new Error('Missing jobId.');
    const jobId=data.jobId??this.pending?.jobId??null;this.job=jobId?clone({...data,jobId}):null;
    if(this.pending){if(jobId)this.pending.jobId=jobId;this.pending.phase=data.status==='failed'?'failed':'polling';this.pending.recoverable=data.recoverable===true;}
    this.progress={...(this.progress??{}),...(data.progress??{})};
    for(const name of ['completedMonths','totalMonths'])if(data[name]!==undefined)this.progress[name]=data[name];
    this.providerMetrics=clone(data.providerMetrics??data.result?.providerMetrics?.summary??data.result?.providerMetrics??this.providerMetrics);
    const event=clone({jobId:data.jobId??this.pending?.jobId??null,status:data.status,simulationId:data.simulationId??data.result?.simulationId??null,...this.progress,progress:this.progress,providerMetrics:this.providerMetrics,recoverable:data.recoverable===true});
    this.notify();try{this.onProgress?.(event);}catch{/* Progress display failures cannot fail a run. */}
  }
  stopWaiting(){this.controller?.abort();}
  cancel(){this.stopWaiting();}
  async operation(name, task) {
    if(this.busy) throw new Error('An operation is already in progress.');
    this.busy=true;this.controller=new AbortController();const generation=this.generation;
    const key=this.keys[name]??=this.makeKey();this.lastError=null;this.notify();
    try {const result=await task(this.controller.signal,key);assertLive(this.controller.signal);if(generation!==this.generation)throw new Error('Discarded stale response.');return result;}
    catch(error){if(generation===this.generation){this.lastError={message:error.message||'Backend operation failed.',recoverable:error.recoverable===true,jobId:this.pending?.jobId??null};if(this.pending?.phase==='failed')this.state=name==='simulate'?'confirmed':name==='confirm'?'review':'draft';this.notify();}throw error;}
    finally {if(generation===this.generation){this.busy=false;this.notify();}}
  }
  async resolveJob(data, signal) {
    for(let attempt=0;;attempt++){
      assertLive(signal);this.reportJob(data);
      if(data.status!=='queued'&&data.status!=='running')break;
      if(attempt>=this.pollLimit)throw new Error('Stopped waiting at the polling limit.');
      await this.sleep(this.pollInterval,signal);assertLive(signal);data=await this.transport.request(`/jobs/${id(data.jobId)}`,undefined,signal);
    }
    if(data.status==='failed'){const error=new Error(typeof data.error==='string'?data.error:'Backend job failed.');error.recoverable=data.recoverable===true;error.jobId=data.jobId??this.pending?.jobId;throw error;}
    return data.status==='complete'?data.result:data;
  }
  finish(name,raw,signal){
    assertLive(signal);
    if(name==='initialize'){this.review=reviewResponse(raw);this.state='review';}
    else if(name==='confirm'){if(raw.confirmed!==true||raw.reviewVersion!==this.review.reviewVersion){if(this.pending)this.pending.phase='failed';throw new Error('Confirmation was not acknowledged for this review version.');}this.state='confirmed';}
    else {this.run=runResponse(raw,this.setup);this.providerMetrics=clone(raw.providerMetrics?.summary??raw.providerMetrics??this.providerMetrics);this.state='ready';}
    this.pending=null;this.lastError=null;this.notify();return name==='initialize'?this.review:name==='simulate'?this.run:raw;
  }
  _credentialHeaders(){return this._apiKey?{'X-DeepSeek-Api-Key':this._apiKey}:undefined;}
  async postOperation(name,body,signal,key,headers){
    this.state=name==='initialize'?'initializing':name==='confirm'?'confirming':'running';
    this.pending={name,phase:'posting',jobId:null,recoverable:false};this.job=null;this.notify();
    const path=name==='initialize'?'/initializations':name==='confirm'?`/initializations/${id(this.review.initializationId)}/confirm`:'/simulations';
    const raw=await this.resolveJob(await this.transport.request(path,body,signal,key,headers),signal);return this.finish(name,raw,signal);
  }
  async initialize(input,file,options={}) {
    if(this.busy)throw new Error('An operation is already in progress.');
    if(this.state!=='draft'&&!(this.state==='initializing'&&this.pending?.name==='initialize'&&!this.pending.jobId))throw new Error('Start a new setup before initializing again.');
    return this.operation('initialize',async(signal,key)=>{
      const setup=validateSetup(input,this.today);
      if(typeof options.apiKey==='string'&&options.apiKey)this._apiKey=options.apiKey;
      // PDF plan upload is currently disabled. A missing file sends metadata only
      // and does not invent a placeholder PDF. Older retries may still pass a file.
      if(!file){
        const fingerprint=JSON.stringify(setup)+':pdf-disabled';
        if(this.lastFingerprint!==null && this.lastFingerprint!==fingerprint){key=this.keys.initialize=this.makeKey();delete this.keys.confirm;delete this.keys.simulate;}
        this.lastFingerprint=fingerprint;this.setup=setup;
        return this.postOperation('initialize',setup,signal,key,this._credentialHeaders());
      }
      await validatePDF(file);
      // The key changes when the user edits the request, but survives retry after a timeout.
      const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
      assertLive(signal);
      const fingerprint=JSON.stringify(setup)+Array.from(new Uint8Array(digest)).join(',');
      if(this.lastFingerprint!==null && this.lastFingerprint!==fingerprint){key=this.keys.initialize=this.makeKey();delete this.keys.confirm;delete this.keys.simulate;}
      this.lastFingerprint=fingerprint;this.setup=setup;
      const form=new FormData();form.append('metadata',JSON.stringify(setup));form.append('plan',file,file.name);
      return this.postOperation('initialize',form,signal,key,this._credentialHeaders());
    });
  }
  async confirm(acknowledged) {
    if(this.state!=='review' || !acknowledged) throw new Error('Review and acknowledge the findings first.');
    if(this.review.items.some(i=>i.kind==='unresolved')) throw new Error('Required information is unresolved. Update the plan and initialize again.');
    return this.operation('confirm',(signal,key)=>this.postOperation('confirm',{reviewVersion:this.review.reviewVersion},signal,key));
  }
  async simulate() {
    if(this.state!=='confirmed')throw new Error('Confirm initialization before starting a simulation.');
    return this.operation('simulate',(signal,key)=>this.postOperation('simulate',{initializationId:this.review.initializationId,reviewVersion:this.review.reviewVersion},signal,key,this._credentialHeaders()));
  }
  async resume(file){
    if(this.busy)throw new Error('An operation is already in progress.');
    const pending=this.pending;
    if(!pending){if(this.state==='ready')return this.run;if(this.state==='review'||this.state==='confirmed')return this.review;throw new Error('No pending backend operation is available to resume.');}
    if(pending.name==='initialize'&&!pending.jobId){if(!file){if(this._apiKey)return this.initialize(this.setup,null,{apiKey:this._apiKey});throw new Error('Reselect the original PDF to retry initialization. PDF bytes are not stored in the browser session.');}return this.initialize(this.setup,file);}
    const body=()=>pending.name==='confirm'?{reviewVersion:this.review.reviewVersion}:{initializationId:this.review.initializationId,reviewVersion:this.review.reviewVersion};
    return this.operation(pending.name,async(signal,key)=>{
      let raw;
      if(pending.jobId){
        const data=await this.transport.request(`/jobs/${id(pending.jobId)}`,undefined,signal);assertLive(signal);
        if(data.status==='failed'&&data.recoverable===true){
          this.reportJob(data);
          if(pending.name==='initialize'){
            if(!file)throw new Error('Reselect the original PDF to retry the failed initialization job. PDF bytes are not stored.');
            await validatePDF(file);const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());assertLive(signal);
            const fingerprint=JSON.stringify(this.setup)+Array.from(new Uint8Array(digest)).join(',');
            if(fingerprint!==this.lastFingerprint)throw new Error('Reselect the original PDF with unchanged bytes before resuming this initialization.');
            const form=new FormData();form.append('metadata',JSON.stringify(this.setup));form.append('plan',file,file.name);return this.postOperation('initialize',form,signal,key,this._credentialHeaders());
          }
          return this.postOperation(pending.name,body(),signal,key,this._credentialHeaders());
        }
        raw=await this.resolveJob(data,signal);
      }else return this.postOperation(pending.name,body(),signal,key,this._credentialHeaders());
      return this.finish(pending.name,raw,signal);
    });
  }
  async snapshot(index,signal) {
    const frame=this.run?.snapshots[index];if(!frame) throw new Error('Snapshot not available.');
    const raw=await this.transport.request(`/simulations/${id(this.run.simulationId)}/snapshots/${id(frame.id)}`,undefined,signal);
    return snapshotResponse(raw,frame.date);
  }
  async exportRun({refresh=false,signal}={}){
    if(this.state!=='ready'||!this.run)throw new Error('Complete a simulation before exporting its full state.');
    const simulationId=this.run.simulationId,generation=this.generation;
    if(!refresh&&this.exportCache?.simulationId===simulationId)return this.exportCache.data;
    if(this.exportPending?.simulationId===simulationId)return this.exportPending.promise;
    const promise=(async()=>{
      const data=await this.transport.request(`/simulations/${id(simulationId)}/export`,undefined,signal);assertLive(signal);
      if(generation!==this.generation||this.run?.simulationId!==simulationId)throw new Error('Discarded stale export response.');
      if(!data||data.schemaVersion!==1||data.run?.simulationId!==simulationId||!Array.isArray(data.monthlyStates)||!Array.isArray(data.monthlyBuildingTotals))throw new Error('Expected the full canonical simulation export.');
      runResponse(data.run,this.setup);this.exportCache={simulationId,data};return data;
    })();
    this.exportPending={simulationId,promise};try{return await promise;}finally{if(this.exportPending?.promise===promise)this.exportPending=null;}
  }
}
