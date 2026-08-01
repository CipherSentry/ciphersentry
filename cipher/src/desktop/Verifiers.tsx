import { Gauge, KeyRound, ShieldCheck, TrendingUp } from "lucide-react";
import { useState } from "react";
import { HoldButton, Stepper, Tag } from "../app/ui";
import { weeklyEmission, weight } from "../network/verifiers";
import { useDesk } from "./store";
import { AreaChart, KV, Panel } from "./widgets";

const fmt = (n: number) => n.toLocaleString("en-US");

export default function Verifiers() {
  const d = useDesk();
  const { epoch } = d;
  const [bondAmt, setBondAmt] = useState(50_000);
  const opNode = d.verifiers.find((v) => v.id.startsWith("vrf:op:"));
  const queued = d.unbondQueue.find((x) => x.verifier === opNode?.id);
  const pct = Math.min(1, Math.max(0, (d.now - epoch.startedAt) / epoch.durMs));
  const tMinus = Math.max(0, Math.ceil((epoch.startedAt + epoch.durMs - d.now) / 1000));
  const bonded = d.verifiers.reduce((s, v) => s + (v.status !== "UNBONDING" ? v.bond : 0), 0);
  const elected = epoch.elected;

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_330px] divide-x divide-edge">
      {/* ---- main ---- */}
      <div className="no-scrollbar min-h-0 overflow-y-auto p-5">
        {/* epoch banner */}
        <div className="grid grid-cols-4 gap-px border border-edge bg-edge">
          <div className="col-span-2 bg-[#0a0d08] p-4">
            <div className="flex items-center gap-2 font-mono text-[8px] tracking-[0.22em] text-mute">
              <Gauge size={10} className="text-volt/70" /> CURRENT EPOCH
            </div>
            <div className="mt-2 font-display text-[34px] font-medium tabular-nums leading-none text-volt">
              {epoch.n.toLocaleString()}
            </div>
            <div className="mt-3">
              <div className="flex justify-between font-mono text-[7.5px] tracking-[0.18em] text-mute/50">
                <span>ROTATION IN T-{tMinus}S</span>
                <span>{Math.round(pct * 100)}%</span>
              </div>
              <div className="mt-1.5 h-1 w-full bg-edge">
                <div className="h-full bg-volt transition-all duration-1000 ease-linear" style={{ width: `${pct * 100}%` }} />
              </div>
            </div>
          </div>
          <div className="bg-[#0a0d08] p-4">
            <div className="font-mono text-[8px] tracking-[0.22em] text-mute">BONDED CAPITAL</div>
            <div className="mt-2 font-display text-[24px] font-medium tabular-nums leading-none text-mist">
              {(bonded / 1e6).toFixed(2)}M
            </div>
            <div className="mt-2 font-mono text-[7.5px] tracking-[0.16em] text-mute/50">CENT · PRE-TGE BONDS</div>
          </div>
          <div className="bg-[#0a0d08] p-4">
            <div className="font-mono text-[8px] tracking-[0.22em] text-mute">SLASHES / LAUNCH GATE</div>
            <div className={`mt-2 font-display text-[24px] font-medium tabular-nums leading-none ${d.slashLog.length > 0 ? "text-amber-300" : "text-mist"}`}>
              {d.slashLog.length}
            </div>
            <div className="mt-2 font-mono text-[7.5px] tracking-[0.16em] text-mute/50">GATE #2 · AUDITS 0/2</div>
          </div>
        </div>

        {/* elected set */}
        <Panel title="ELECTED QUORUM — score = bond × accuracy² × jitter" className="mt-4 border-edge" bodyClass="overflow-visible">
          <div className="grid grid-cols-3 gap-px bg-edge">
            {elected.map((id, i) => {
              const v = d.verifiers.find((x) => x.id === id);
              if (!v) return null;
              const w = weight(v);
              const total = elected.reduce((s, x) => {
                const vv = d.verifiers.find((y) => y.id === x);
                return s + (vv ? weight(vv) : 0);
              }, 0);
              return (
                <div key={id} className="bg-[#0a0d08] p-3.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10.5px] text-volt">{id}</span>
                    <span className="font-mono text-[7.5px] tracking-[0.14em] text-mute/50">SEAT {i + 1}</span>
                  </div>
                  <div className="mt-2.5 font-mono text-[8.5px] leading-[1.8] text-mute">
                    weight <span className="text-mist">{(w / 1e6).toFixed(2)}M</span>
                    <br />
                    share <span className="text-volt">{((w / total) * 100).toFixed(1)}%</span> of votes
                  </div>
                  <div className="mt-2 h-1 w-full bg-edge">
                    <div className="h-full bg-volt/70" style={{ width: `${(w / total) * 100}%` }} />
                  </div>
                  <div className="mt-2 font-mono text-[7.5px] tracking-[0.14em] text-mute/60">
                    EPOCH VOTES {v.correctEpoch}/{v.votesEpoch}
                    {v.status === "SLASHED" && <span className="ml-2 text-red-400">SLASHED</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>

        {/* bond table */}
        <Panel title="BOND REGISTRY — sorted by weight" className="mt-4 border-edge" bodyClass="no-scrollbar overflow-y-auto">
          <div className="grid grid-cols-[110px_80px_100px_110px_90px_90px_1fr_86px] items-center gap-2 border-b border-edge px-3 py-2 font-mono text-[7.5px] tracking-[0.18em] text-mute/50">
            <span>VERIFIER</span><span>STATUS</span><span className="text-right">BOND CENT</span><span className="text-right">WEIGHT</span><span className="text-right">ACCURACY</span><span className="text-right">FEES USDC</span><span className="text-right">ACCRUED CENT</span><span className="text-right">WEIGHT BAR</span>
          </div>
          {[...d.verifiers]
            .sort((a, b) => weight(b) - weight(a))
            .map((v) => {
              const maxW = weight(d.verifiers[0]);
              const slashing = d.slashLog[0]?.verifier === v.id && d.now - d.slashLog[0].at < 6000;
              return (
                <div
                  key={v.id}
                  className={`grid grid-cols-[110px_80px_100px_110px_90px_90px_1fr_86px] items-center gap-2 border-b border-edge/60 px-3 py-[7px] font-mono text-[9.5px] ${
                    slashing ? "bg-red-400/[0.07]" : ""
                  }`}
                >
                  <span className={elected.includes(v.id) ? "text-volt" : "text-mist/80"}>
                    {v.id}
                    {v.id.startsWith("vrf:op:") && <span className="ml-1.5 bg-volt px-1 text-[6.5px] font-semibold text-void">YOU</span>}
                  </span>
                  <span>
                    {v.status === "UNBONDING" ? (
                      <Tag tone="amber" className="px-1 py-0 text-[6.5px]">UNBONDING</Tag>
                    ) : v.id.startsWith("vrf:op:") && v.status === "BONDED" ? (
                      <button
                        onClick={() => d.requestUnbond(v.id)}
                        className="border border-red-400/50 px-1 py-0 font-mono text-[6.5px] tracking-[0.14em] text-red-400 transition-colors hover:bg-red-400/10"
                      >
                        UNBOND
                      </button>
                    ) : (
                      <Tag tone={v.status === "SLASHED" ? "red" : "volt"} className="px-1 py-0 text-[6.5px]">
                        {v.status}
                      </Tag>
                    )}
                  </span>
                  <span className="text-right tabular-nums text-mist">{fmt(v.bond)}</span>
                  <span className="text-right tabular-nums text-mute">{(weight(v) / 1e6).toFixed(2)}M</span>
                  <span className={`text-right tabular-nums ${v.accuracy >= 0.985 ? "text-volt/90" : "text-amber-300"}`}>
                    {(v.accuracy * 100).toFixed(1)}%
                  </span>
                  <span className="text-right tabular-nums text-mist/80">{v.earnedUsdc.toFixed(1)}</span>
                  <span className="text-right tabular-nums text-volt/80">{fmt(v.accruedCent)}</span>
                  <span className="flex justify-end">
                    <span className="h-1.5 max-w-full bg-edge2">
                      <span className="block h-full bg-volt/60" style={{ width: `${(weight(v) / maxW) * 100}%`, minWidth: 2 }} />
                    </span>
                  </span>
                </div>
              );
            })}
          <div className="px-3 py-2 font-mono text-[7.5px] tracking-[0.16em] text-mute/50">
            BOND FLOOR 25,000 CENT · UNBONDING 7 DAYS · MISS QUORUM = 0 REWARD, 0 SLASH
          </div>
        </Panel>
      </div>

      {/* ---- right rail ---- */}
      <div className="flex min-h-0 flex-col divide-y divide-edge">
        {/* operator verifier node — the V0.2 loop closer */}
        <Panel title="OPERATOR NODE — BOND & VOTE" className="border-0" bodyClass="overflow-visible px-3 py-3">
          {!opNode ? (
            <>
              <KV k="AVAILABLE" v={`${d.centBal.toLocaleString()} CENT`} tone="volt" />
              <KV k="FLOOR" v="25,000 CENT" />
              <div className="mt-3 flex items-center justify-between gap-3">
                <Stepper value={bondAmt} min={25_000} max={Math.max(25_000, Math.floor(d.centBal / 25_000) * 25_000)} step={25_000} onChange={setBondAmt} />
              </div>
              <HoldButton
                className="mt-3"
                label={`HOLD TO BOND ${bondAmt.toLocaleString()} CENT`}
                onDone={() => d.bondVerifier(bondAmt)}
              />
              <div className="mt-2.5 flex items-center gap-2 font-mono text-[7px] tracking-[0.18em] text-mute/50">
                <KeyRound size={9} className="text-volt/60" />
                NODE ID DERIVES FROM YOUR DEVICE KEY
              </div>
            </>
          ) : opNode.status === "UNBONDING" ? (
            <>
              <KV k="NODE" v={opNode.id} tone="volt" />
              <KV k="STATUS" v="UNBONDING" tone="amber" />
              <KV k="FROZEN BOND" v={`${(queued?.amount ?? opNode.bond).toLocaleString()} CENT`} tone="amber" />
              <div className="mt-3 h-1.5 w-full bg-edge">
                <div className="h-full bg-amber-300 transition-all duration-700" style={{ width: `${((3 - (queued?.completesIn ?? 1)) / 3) * 100}%` }} />
              </div>
              <div className="mt-2 font-mono text-[7.5px] tracking-[0.18em] text-mute/60">
                RETURNS IN {queued?.completesIn ?? 1} EPOCHS (7D) · EXITED ALL ELECTIONS
              </div>
            </>
          ) : (
            <>
              <KV k="NODE" v={opNode.id} tone="volt" />
              <KV k="BOND" v={`${opNode.bond.toLocaleString()} CENT`} />
              <KV k="ACCURACY" v={`${(opNode.accuracy * 100).toFixed(1)}%`} tone={opNode.accuracy >= 0.985 ? "volt" : "amber"} />
              <KV k="EPOCH VOTES" v={`${opNode.correctEpoch}/${opNode.votesEpoch}`} />
              <KV k="FEES EARNED" v={`${opNode.earnedUsdc.toFixed(2)} USDC + ${opNode.accruedCent.toLocaleString()} CENT`} tone="volt" />
              {opNode.status === "SLASHED" && (
                <div className="mt-2 border border-red-400/40 bg-red-400/[0.06] px-2.5 py-2 font-mono text-[8px] tracking-[0.14em] text-red-400">
                  SLASHED THIS EPOCH — BOND −10% BURNED
                </div>
              )}
              <button
                onClick={() => d.requestUnbond(opNode.id)}
                className="mt-3 w-full border border-red-400/50 py-3 font-mono text-[9px] tracking-[0.22em] text-red-400 transition-colors hover:bg-red-400/10"
              >
                REQUEST UNBOND — 7D ({(opNode.bond).toLocaleString()} CENT)
              </button>
            </>
          )}
        </Panel>

        <Panel title="EMISSIONS — WEEK 3 / 416" className="flex-1 border-0" bodyClass="overflow-visible px-3 py-3">
          <KV k="WEEKLY RATE R(3)" v={`${(weeklyEmission(3) / 1e6).toFixed(2)}M CENT`} tone="volt" />
          <KV k="ACCRUED (SIM)" v={`${fmt(d.emittedCent)} CENT`} />
          <KV k="POOL ISSUED" v={`${((d.emittedCent / 350e6) * 100).toFixed(4)}%`} />
          <div className="mt-3 h-16">
            <AreaChart data={[12, 18, 15, 24, 20, 32, 28, 26, 38, 34, 44, 40, 48, 42, 52]} />
          </div>
          <div className="mt-2 font-mono text-[7px] tracking-[0.18em] text-mute/40">EMISSION ∝ BOND × ACCURACY² AMONG VOTERS</div>
        </Panel>

        <Panel title="SLASH EXECUTOR LOG" className="border-0" bodyClass="no-scrollbar max-h-[190px] overflow-y-auto">
          {d.slashLog.length === 0 && (
            <div className="px-3 py-4 font-mono text-[8.5px] tracking-[0.16em] text-mute/50">
              CLEAN — EPOCH EJECTIONS AND BURNS PRINT HERE
            </div>
          )}
          {d.slashLog.map((s) => (
            <div key={s.id} className="border-b border-edge/60 px-3 py-2.5 font-mono text-[8.5px] last:border-b-0">
              <div className="flex items-center justify-between">
                <span className="text-red-400">−{fmt(s.amount)} CENT</span>
                <span className="text-mute/50">E{s.epoch}</span>
              </div>
              <div className="mt-1 text-mist/70">{s.verifier}</div>
              <div className="mt-0.5 text-[7px] tracking-[0.12em] text-mute/50">{s.reason} · 50% BURN / 50% CHALLENGER+FUND</div>
            </div>
          ))}
        </Panel>

        <Panel title="FLEET CLAIMS — PRE-TGE LEDGER" className="border-0" bodyClass="overflow-visible px-3 py-3">
          <div className="flex items-center gap-2.5 font-mono text-[8px] tracking-[0.2em] text-mute">
            <TrendingUp size={11} className="text-volt/70" /> EPOCHS OBSERVED {d.emittedCent > 0 ? Math.max(1, Math.floor(d.emittedCent / 2000)) : 0}
          </div>
          <div className="mt-3 font-display text-[30px] font-medium tabular-nums leading-none text-volt">
            {fmt(Math.floor(d.fleetPoints))}
          </div>
          <div className="mt-1.5 font-mono text-[8px] tracking-[0.18em] text-mute/50">
            POINTS · 1 PER USDC YOUR FLEET SETTLES
          </div>
          <div className="mt-3 border border-edge px-3 py-2.5 font-mono text-[8px] leading-[1.8] tracking-[0.1em] text-mute">
            EST. CLAIM AT TGE: <span className="text-mist">{fmt(Math.floor(d.fleetPoints * 1.4))} CENT</span>
            <br />
            CONVERSION FOLLOWS LAUNCH GATE #4 — 60D ACCRUAL FIRST
          </div>
          <div className="mt-3 flex items-center gap-2 font-mono text-[7.5px] tracking-[0.18em] text-mute/50">
            <ShieldCheck size={10} className="text-volt/60" />
            CLAIMS ARE PROOF-OF-WORK, NOT AN AIRDROP
          </div>
        </Panel>
      </div>
    </div>
  );
}
