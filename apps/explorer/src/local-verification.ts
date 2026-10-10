import type { GLMap } from './gl-map.ts';
import type { TimeMotion, MotionSeekOutcome } from './time-motion.ts';

type VerificationStatus = 'PASS' | 'FAIL' | 'NOT_RUN';
type ScrubMode = 'within-year' | 'year-crossing';
type RendererDiagnostics = ReturnType<GLMap['getDiagnostics']>;
type Outcomes = { committed: number; stale: number; error: number };
interface ScrubPhase {
  name: ScrubMode; status: VerificationStatus; durationTargetMs: number; actualDurationMs: number;
  canonicalDayRange: readonly [number, number]; traversal: string; frameOpportunities: number; rafFps: number;
  rafIntervalP95Ms: number; rafIntervalsMs: number[]; intervalsOver34Ms: number;
  requestedUpdates: number; outcomes: Outcomes; finalTargetDay: number; finalRequestedDay: number;
  finalCommittedDay: number | null; completionLatencyMs: number; failures: string[];
  hostBefore: unknown; hostAfter: unknown;
}
export interface ScrubVerificationReceipt {
  schema: 'chronicle-local-scrub-v1'; status: VerificationStatus; targetRafFps: 58;
  environment: ReturnType<typeof environment>; phases: ScrubPhase[]; failures: string[];
  idleBaseline: { durationMs: number; frameOpportunities: number; rafFps: number; rafIntervalsMs: number[] } | null;
  restoration: { requestedDay: number; status: string } | null;
  meaning: string;
}
interface StyleReloadStep {
  appearance: 'contrast' | 'paper'; elapsedMs: number; sameCanvas: boolean;
  diagnostics: RendererDiagnostics; failures: string[];
}
export interface StyleReloadVerificationReceipt {
  schema: 'chronicle-local-style-reload-v1'; status: VerificationStatus;
  environment: ReturnType<typeof environment>; before: RendererDiagnostics | null; after: RendererDiagnostics | null;
  steps: StyleReloadStep[]; failures: string[]; meaning: string;
}
export interface LocalVerificationActions {
  runScrub(): Promise<ScrubVerificationReceipt>;
  runStyleReloads(): Promise<StyleReloadVerificationReceipt>;
}
interface LocalVerificationHost {
  motion(): TimeMotion | undefined;
  gl(): GLMap | undefined;
  canvas(): HTMLCanvasElement | null;
  snapshot(): unknown;
  signal: AbortSignal;
}

const day = (year: number, month = 0, date = 1) => { const value = new Date(0); value.setUTCFullYear(year, month, date); return value.valueOf() / 86_400_000; };
const environment = () => ({ userAgent: navigator.userAgent, width: innerWidth, height: innerHeight,
  devicePixelRatio, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  visibility: document.visibilityState, physicalScanout: 'NOT_RUN' as const });
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Linear continuous days and repeated crossings use the same canonical scrub API. */
export function scrubTarget(mode: ScrubMode, progress: number): { day: number; range: readonly [number, number] } {
  const fraction = Math.max(0, Math.min(1, progress));
  const range = mode === 'within-year' ? [day(2000), day(2000, 11, 30)] as const : [day(2000, 6, 1), day(2001, 5, 30)] as const;
  // Two round trips over six seconds; every crossing remains a real input.
  const position = mode === 'within-year' ? fraction : 1 - Math.abs((fraction * 4 % 2) - 1);
  return { day: range[0] + (range[1] - range[0]) * position, range };
}

function nextFrame(signal: AbortSignal): Promise<number> {
  return new Promise((resolve, reject) => {
    if(signal.aborted){reject(signal.reason);return;}
    const aborted = () => { cancelAnimationFrame(id); reject(signal.reason); };
    const id=requestAnimationFrame(timestamp=>{signal.removeEventListener('abort',aborted);resolve(timestamp);});
    signal.addEventListener('abort',aborted,{once:true});
  });
}

async function readyMap(map: GLMap, signal: AbortSignal): Promise<RendererDiagnostics> {
  const deadline=performance.now()+30_000;
  while(true){
    signal.throwIfAborted();
    const state=map.getDiagnostics();
    if(state.styleLoaded && state.tilesLoaded && !state.styleReload.pending)return state;
    if(performance.now()>=deadline)throw new Error('Style or visible map tiles did not become ready within 30 seconds.');
    await nextFrame(signal);
  }
}

/** Developer-triggered measurements only; this module grants no data or model authority. */
export function createLocalVerification(host: LocalVerificationHost): LocalVerificationActions {
  let running=false;
  return {
    async runScrub(){
      const receipt:ScrubVerificationReceipt={schema:'chronicle-local-scrub-v1',status:'NOT_RUN',targetRafFps:58,
        environment:environment(),phases:[],failures:[],restoration:null,idleBaseline:null,
        meaning:'Animation-frame callback opportunities under actual host scrubbing; not GPU timing, physical scanout, or physical-device certification. Within-year and year-crossing workloads are reported separately; misses remain failures.'};
      const motion=host.motion();
      if(running || !motion || document.hidden || host.signal.aborted){receipt.failures.push('Requires an idle verification harness, visible document and live Atlas clock.');return receipt;}
      running=true;const restore=motion.snapshot.requestedTime;motion.setPlaying(false);
      try{
        const idle:number[]=[await nextFrame(host.signal)];
        while(idle.at(-1)!-idle[0]<2000){if(document.hidden)throw new Error('Document became hidden during idle frame baseline.');idle.push(await nextFrame(host.signal));}
        receipt.idleBaseline={durationMs:idle.at(-1)!-idle[0],frameOpportunities:idle.length,
          rafFps:(idle.length-1)*1000/(idle.at(-1)!-idle[0]),rafIntervalsMs:idle.slice(1).map((stamp,index)=>stamp-idle[index])};
        for(const name of ['within-year','year-crossing'] as const){
          const first=scrubTarget(name,0),prepared=await motion.scrub(first.day);
          if(prepared.status!=='committed')throw new Error('Could not prepare the actual scrub start date.');
          await nextFrame(host.signal);await nextFrame(host.signal);
          const hostBefore=host.snapshot(),timestamps:number[]=[],outcomes:Outcomes={committed:0,stale:0,error:0};
          let requestedUpdates=0,finalTargetDay=Math.floor(first.day),last:Promise<MotionSeekOutcome>=Promise.resolve(prepared);
          const failures:string[]=[];const duration=6000,start=await nextFrame(host.signal);
          timestamps.push(start);
          let stamp=start;
          do{
            stamp=await nextFrame(host.signal);timestamps.push(stamp);
            if(document.hidden)throw new Error('Document became hidden during the scrub workload.');
            const target=scrubTarget(name,(stamp-start)/duration);finalTargetDay=Math.floor(target.day);requestedUpdates++;
            last=motion.scrub(target.day).then(result=>{outcomes[result.status]++;return result;});
          }while(stamp-start<duration);
          const endInput=performance.now();const final=await last;
          await nextFrame(host.signal);await nextFrame(host.signal);
          const finalState=motion.snapshot,completionLatencyMs=performance.now()-endInput;
          const intervals=timestamps.slice(1).map((time,index)=>time-timestamps[index]),sorted=[...intervals].sort((a,b)=>a-b);
          const elapsed=stamp-start,fps=intervals.length*1000/elapsed;
          if(final.status!=='committed' || finalState.requestedTime!==finalTargetDay || finalState.committedTime!==finalTargetDay)failures.push('Final target did not commit exactly.');
          if(outcomes.error)failures.push(`${outcomes.error} scrub inputs returned errors.`);
          if(fps<58)failures.push(`Observed ${fps.toFixed(2)} RAF opportunities per second; target is at least 58.`);
          receipt.phases.push({name,status:failures.length?'FAIL':'PASS',durationTargetMs:duration,actualDurationMs:elapsed,
            canonicalDayRange:first.range,traversal:name==='within-year'?'Linear 2000-01-01 through 2000-12-30':'Two round trips between 2000-07-01 and 2001-06-30, crossing the observation/reference boundary four times',
            frameOpportunities:timestamps.length,rafFps:fps,rafIntervalP95Ms:sorted[Math.max(0,Math.ceil(sorted.length*.95)-1)]??0,
            rafIntervalsMs:intervals,intervalsOver34Ms:intervals.filter(value=>value>34).length,requestedUpdates,outcomes,
            finalTargetDay,finalRequestedDay:finalState.requestedTime,finalCommittedDay:finalState.committedTime,completionLatencyMs,failures,
            hostBefore,hostAfter:host.snapshot()});
        }
        receipt.status=receipt.phases.every(phase=>phase.status==='PASS')?'PASS':'FAIL';
      }catch(error){receipt.status='FAIL';receipt.failures.push(message(error));}
      finally{
        if(!host.signal.aborted){const result=await motion.seekTime(restore);receipt.restoration={requestedDay:restore,status:result.status};if(result.status!=='committed'){receipt.status='FAIL';receipt.failures.push('The original cursor could not be restored.');}}
        running=false;
      }
      return receipt;
    },
    async runStyleReloads(){
      const receipt:StyleReloadVerificationReceipt={schema:'chronicle-local-style-reload-v1',status:'NOT_RUN',environment:environment(),before:null,after:null,steps:[],failures:[],
        meaning:'Actual MapLibre style reloads, visible-tile readiness and owned-resource counts. Heap/GPU memory leak certification and physical hardware remain NOT_RUN.'};
      const map=host.gl();
      if(!map){receipt.failures.push('Canvas fallback is active; no live MapLibre instance exists for a style-reload check.');return receipt;}
      if(running || document.hidden || host.signal.aborted){receipt.failures.push('Requires idle verification, a visible document and a live renderer.');return receipt;}
      running=true;host.motion()?.setPlaying(false);
      try{
        const before=receipt.before=await readyMap(map,host.signal),canvas=host.canvas();
        for(const appearance of ['contrast','paper'] as const){
          const start=performance.now();await map.reloadBasemap(appearance);const diagnostics=await readyMap(map,host.signal),failures:string[]=[];
          const sameCanvas=host.canvas()===canvas;
          if(!sameCanvas || diagnostics.mapInstances!==1)failures.push('The original single map canvas was not preserved.');
          if(JSON.stringify(diagnostics.mountedSourceIds)!==JSON.stringify(before.mountedSourceIds))failures.push('Mounted source identities changed after restoration.');
          if(JSON.stringify(diagnostics.mountedLayerIds)!==JSON.stringify(before.mountedLayerIds))failures.push('Mounted layer identities or order changed after restoration.');
          if(diagnostics.styleReload.listeners!==before.styleReload.listeners || diagnostics.styleReload.listeners!==1)failures.push('Owned style-load listener count changed.');
          if(diagnostics.sourceCount>diagnostics.sourceLimit || diagnostics.styleReload.failures!==before.styleReload.failures)failures.push('Source budget or style lifecycle failure count increased.');
          if(JSON.stringify(diagnostics.activeStyleState)!==JSON.stringify(before.activeStyleState))failures.push('Committed source, generation or selected feature state was not restored.');
          if(diagnostics.activeStyleState?.selected.some(feature=>!feature.restored))failures.push('A selected feature lacks its restored MapLibre feature state.');
          receipt.steps.push({appearance,elapsedMs:performance.now()-start,sameCanvas,diagnostics,failures});
        }
        receipt.after=map.getDiagnostics();receipt.status=receipt.steps.every(step=>!step.failures.length)?'PASS':'FAIL';
      }catch(error){receipt.status='FAIL';receipt.failures.push(message(error));receipt.after=map.getDiagnostics();}
      finally{running=false;}
      return receipt;
    },
  };
}
