import { OctagonX, ShieldCheck } from "lucide-react";
import { HoldButton, Stepper, Switch } from "../app/ui";
import { CipherSentry } from "../sdk/ciphersentry";
import { describeTransport } from "../sdk/livePath";
import { useDesk } from "./store";
import { Panel } from "./widgets";

const cent = CipherSentry.shared();

function PolicyRow({
  idx,
  name,
  desc,
  control,
}: {
  idx: string;
  name: string;
  desc: string;
  control: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 border-b border-edge px-4 py-4 last:border-b-0">
      <span className="font-mono text-[9px] text-volt/60">{idx}</span>
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[10.5px] tracking-[0.14em] text-mist">{name}</div>
        <div className="mt-1 truncate font-mono text-[8.5px] tracking-[0.1em] text-mute/60">{desc}</div>
      </div>
      {control}
    </div>
  );
}

export default function Guardrails() {
  const d = useDesk();
  const L = d.limits;

  const jsonLines: [string, React.ReactNode][] = [
    ["fleet.daily_cap_usdc", <span className="text-volt">{L.global}</span>],
    ["escrow.auto_approve_below_usdc", <span className="text-volt">{L.requireAbove}</span>],
    ["auto_pause.failures_per_hr", <span className="text-volt">{L.autoPause ? 2 : 0}</span>],
    ["routing.min_tier", <span className="text-code-str">{L.minTier ? '"T1"' : '"T0"'}</span>],
    ["rate_limit.tasks_per_min_per_agent", <span className="text-volt">{L.ratePerMin}</span>],
    ["region.allowlist", <span className="text-code-str">{`["${L.region}"]`}</span>],
    ["signing.key", <span className="text-code-str">"op:0x71be…e8d3"</span>],
  ];

  const hud = describeTransport(cent.transport);

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_400px] divide-x divide-edge">
      {/* left: policies */}
      <div className="no-scrollbar min-h-0 overflow-y-auto p-5">
        <div className="mb-4 flex flex-wrap items-center gap-3 border border-edge bg-panel/50 px-3 py-2 font-mono text-[8.5px] tracking-[0.16em]">
          <span
            className={
              hud.tone === "volt"
                ? "text-volt"
                : hud.tone === "amber"
                  ? "text-amber-600"
                  : hud.tone === "red"
                    ? "text-red-400"
                    : "text-mute"
            }
          >
            ●{hud.primary}
          </span>
          <span className="text-mute">{hud.secondary}</span>
          {hud.sessionLine && <span className="text-volt">{hud.sessionLine}</span>}
          {hud.kind === "sim" && <span className="text-mute/50">SIM — MUTATIONS LOCAL ONLY</span>}
        </div>
        <Panel title="POLICY — SET ONCE, AGENTS RUN INSIDE IT" className="border-edge">
          <PolicyRow idx="P1" name="FLEET DAILY CAP · USDC" desc="ALL AGENTS COMBINED · HARD STOP" control={
            <Stepper value={L.global} min={250} max={10000} step={250} onChange={(v) => { d.setGlobalLimit(v); d.toast(`FLEET CAP → ${v} USDC/DAY`); }} />
          } />
          <PolicyRow idx="P2" name="APPROVAL REQUIRED ABOVE · USDC" desc="SINGLE ESCROW · BELOW AUTO-SIGNS" control={
            <Stepper value={L.requireAbove} min={25} max={1000} step={25} onChange={(v) => { d.setRequireAbove(v); d.toast(`THRESHOLD → ${v} USDC`); }} />
          } />
          <PolicyRow idx="P3" name="AUTO-PAUSE ON VERIFICATION FAILURES" desc="2 FAILURES WITHIN 60 MIN → AGENT IDLES" control={
            <Switch on={L.autoPause} onChange={(v) => { d.setFlag("autoPause", v); d.toast(v ? "AUTO-PAUSE ARMED" : "AUTO-PAUSE DISARMED"); }} />
          } />
          <PolicyRow idx="P4" name="ROUTE TO TIER T1+ ONLY" desc="PROBATIONARY T0 AGENTS GET NO WORK" control={
            <Switch on={L.minTier} onChange={(v) => { d.setFlag("minTier", v); d.toast(v ? "ROUTING: T1 AND ABOVE" : "ROUTING: ALL TIERS"); }} />
          } />
          <PolicyRow idx="P5" name="RATE LIMIT · TASKS/MIN/AGENT" desc="BACKPRESSURE AGAINST RUNAWAY LOOPS" control={
            <Stepper value={L.ratePerMin} min={1} max={60} step={1} onChange={(v) => { d.setRatePerMin(v); d.toast(`RATE LIMIT → ${v}/MIN`); }} />
          } />
          {d.agents.filter((a) => a.mine).map((a, i) => (
            <PolicyRow key={a.id} idx={`A${i + 1}`} name={`${a.name.toUpperCase()} · DAILY CAP`} desc={`${a.specialty} · TRUST ${a.trust}`} control={
              <Stepper value={L.perAgent[a.id] ?? 250} min={50} max={2000} step={50} onChange={(v) => { d.setAgentLimit(a.id, v); d.toast(`${a.name} CAP → ${v}`); }} />
            } />
          ))}
        </Panel>

        <div className="mt-4 border border-red-400/40 bg-red-400/[0.04] p-4">
          <div className="flex items-center gap-2.5 font-mono text-[9px] tracking-[0.22em] text-red-400">
            <OctagonX size={13} /> KILL SWITCH — FLEET-WIDE
          </div>
          <p className="mt-2 font-mono text-[9px] leading-[1.8] tracking-[0.08em] text-mute">
            STOPS ALL TASK ACCEPTANCE. OPEN ESCROWS SETTLE OUT NORMALLY. REQUIRES HOLD.
          </p>
          <HoldButton
            tone="red"
            className="mt-3"
            label={d.halted ? "HOLD TO RESUME FLEET" : "HOLD TO HALT FLEET"}
            onDone={() => {
              d.toggleHalt();
              d.toast(d.halted ? "FLEET RESUMED — ROUTING ON" : "FLEET HALTED — AGENTS IDLE");
            }}
          />
        </div>

        <div className="mt-4 flex items-center gap-2.5 font-mono text-[8px] tracking-[0.2em] text-mute/50">
          <ShieldCheck size={11} className="text-volt/60" />
          POLICY IS SIGNED ON WRITE. AGENTS VERIFY BEFORE EVERY TASK.
        </div>
      </div>

      {/* right: live policy file */}
      <Panel
        title="POLICY.CEN.JSON — LIVE WRITE-BACK"
        className="m-5 border-edge"
        right={<span className="font-mono text-[7.5px] tracking-[0.18em] text-volt">SIG ✓</span>}
        bodyClass="no-scrollbar overflow-y-auto"
      >
        <pre className="surface-code border-0 p-4 font-mono text-[11px] leading-[2]">
          <div className="text-code-mute">{"{"}</div>
          {jsonLines.map(([k, v], i) => (
            <div key={k} className="whitespace-pre">
              <span className="text-code-fg/90">  "{k}"</span>
              <span className="text-code-mute">: </span>
              {v}
              {i < jsonLines.length - 1 && <span className="text-code-mute">,</span>}
            </div>
          ))}
          <div className="text-code-mute">{"}"}</div>
        </pre>
        <div className="border-t border-edge px-4 py-3 font-mono text-[8px] leading-[1.9] tracking-[0.16em] text-mute">
          LAST WRITE: 3S AGO · BY op:0x71be…e8d3
          <br />
          PROPAGATION: 214 NODES · &lt; 500MS
        </div>
      </Panel>
    </div>
  );
}
