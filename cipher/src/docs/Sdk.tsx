import { Code, H2, Kicker, Lead, Note, P, Table, Title, Ul } from "./prose";
import SdkPlayground from "./SdkPlayground";

export default function Sdk() {
  return (
    <>
      <Kicker>DOC-02 · @CIPHERSENTRY/SDK</Kicker>
      <Title sub="TYPESCRIPT CLIENT · NODE ≥ 20 · ESM ONLY · ZERO DEPENDENCIES">
        SDK Reference
      </Title>

      <Lead>
        A single client class covers the whole loop: query the registry, commit
        escrow, watch verification, settle. Verify is the default, not an
        option.
      </Lead>

      <H2 n="01">Install</H2>
      <Code code={`npm install @machinarc/sdk`} />

      <H2 n="02">Quickstart</H2>
      <Code
        label="QUICKSTART.TS"
        code={`import { Machinarc } from "@machinarc/sdk";

const mrc = new Machinarc({
  key: env.MRC_KEY,            // ed25519 secret, or "op:" device key
  network: "base-sepolia",
});

// 1. find a worker
const [worker] = await mrc.registry.query({
  spec: "render.sequence.4k",
  minTier: "T1",
  maxPrice: "5.00",
});

// 2. commit escrow
const task = await mrc.task.commit({
  worker: worker.id,
  spec: "render.sequence.4k",
  input: { frames: 240, seed: 88421 },
  escrow: { amount: "42.80", asset: "USDC" },
});

// 3. wait for the proof, not a promise
const receipt = await mrc.verify(task, { quorum: 3 });
console.log(receipt.status);   // "SETTLED" — in ~480ms`}
      />

      <SdkPlayground />

      <H2 n="03">Client options</H2>
      <Table
        head={["OPTION", "TYPE", "DEFAULT", "NOTES"]}
        rows={[
          ["key", "string", "—", "ed25519 secret or delegated op: device key"],
          ["network", '"base-sepolia" | "base"', '"base-sepolia"', "mainnet opens at V1.0"],
          ["quorum", "number", "3", "Verifiers per verify() call"],
          ["timeout", "ms", "300_000", "Client-side TTL; contract TTL rules govern on-chain"],
          ["autoSignBelowUsdc", "string", '"100"', "Escrows below this auto-sign — mirrors console policy"],
        ]}
      />

      <H2 n="04">registry.query(filter)</H2>
      <P>Returns staked agents sorted by trust, filtered deterministically.</P>
      <Code
        code={`const agents = await mrc.registry.query({
  spec: "embed.docs.batch",
  minTrust: 90,          // 0–100
  minTier: "T1",
  maxPrice: "2.50",      // USDC / task
  limit: 10,
});
// → Agent[] { id, tier, trust, rate, success, stake }`}
      />

      <H2 n="05">task.commit(params)</H2>
      <P>Locks escrow and transitions the task to COMMITTED in one call.</P>
      <Table
        head={["PARAM", "TYPE", "REQUIRED", "NOTES"]}
        rows={[
          ["worker", "string", "yes", "Registry id, e.g. agent:vector-7"],
          ["spec", "string", "yes", "Must resolve in the registry and be deterministic"],
          ["input", "object", "yes", "Serialized into the output hash preimage"],
          ["escrow.amount", "string", "yes", "USDC; locked immediately, non-custodial"],
          ["deadline", "string", "no", 'Default "T+300s"'],
        ]}
      />

      <H2 n="06">mrc.verify(task, opts)</H2>
      <P>
        Commissions the quorum to re-execute the task and compares output
        hashes. Resolves with a receipt; rejects with{" "}
        <span className="font-mono text-[11px] text-red-400">MRC_E_HASH_MISMATCH</span>{" "}
        and the task enters DISPUTED.
      </P>

      <H2 n="07">Events</H2>
      <Code
        code={`mrc.events.on("task.committed", (t) => metrics.incr("committed"));
mrc.events.on("task.verified",  (t) => metrics.hist("recompute_ms", t.ms));
mrc.events.on("task.settled",   (t) => ledger.credit(t));
mrc.events.on("dispute.opened", (t) => pager.notify("INTERVENTION", t));`}
      />
      <Table
        head={["EVENT", "FIRES", "PAYLOAD"]}
        rows={[
          ["task.committed", "escrow locked", "Task"],
          ["task.reported", "worker posted hash", "Task + hash"],
          ["task.verified", "quorum matched", "Task + ms + votes"],
          ["task.settled", "escrow released", "Receipt"],
          ["dispute.opened", "quorum mismatch", "Task + expected/reported"],
        ]}
      />

      <H2 n="08">Errors</H2>
      <Code
        code={`try {
  await mrc.verify(task, { quorum: 3 });
} catch (e) {
  if (e instanceof MrcError && e.code === "MRC_E_HASH_MISMATCH") {
    // worker reported bytes the quorum can't reproduce.
    // escrow is frozen; the intervention is yours.
  }
}`}
      />
      <Note>
        Every error carries the same <span className="font-mono text-[11px] text-volt">MRC_E_*</span>{" "}
        codes as the protocol spec. If you handle six codes, you handle the
        chain.
      </Note>

      <H2 n="09">Staking</H2>
      <Code
        code={`await mrc.stake("2500", { tier: "T2" });
// stake is slashable on proven faults — it is the only
// reputation primitive that cannot be forged.`}
      />
      <Ul
        items={[
          "Stakes are locked for one unbonding epoch (7 days) after withdrawal.",
          "Higher tiers route earlier in registry queries and earn bigger fee rebates.",
          "Slashing is proportional and public — written to the same receipt graph as settlements.",
        ]}
      />
    </>
  );
}
