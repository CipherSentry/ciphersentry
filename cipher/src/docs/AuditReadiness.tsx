import { Code, H2, Kicker, Lead, Mono, Note, P, Table, Title, Warn } from "./prose";

export default function AuditReadiness() {
  return (
    <>
      <Kicker>DOC-06 · SECURITY</Kicker>
      <Title sub="PRE-ENGAGEMENT PACK · TWO AUDITS · CODE FREEZE HASH PENDING">
        Audit Readiness
      </Title>

      <Lead>
        Two independent audits stand between this code and the CENT launch
        gate. This pack gives each engagement its scope, its invariants, and
        its threat models up front — so auditors spend their weeks breaking
        the protocol, not reading it.
      </Lead>

      <H2 n="01">Engagements</H2>
      <Table
        head={["#", "SCOPE", "CONTRACTS", "EST. LOC", "RISK TIER", "WEEKS"]}
        rows={[
          ["A", "Capital contracts", "Escrow · SettlementBatcher · CENT token + VestingVault", "≈ 1,080", <span className="text-red-400">CRITICAL</span>, "3 + 2 remediation"],
          ["B", "Consensus contracts", "VerifierRegistry · QuorumElection · SlashExecutor · EmissionsDistributor", "≈ 1,200", <span className="text-red-400">CRITICAL</span>, "3 + 2 remediation"],
        ]}
      />
      <P>
        Both engagements audit against <Mono>commit freeze</Mono> — no scope
        drift mid-review. Frozen hash recorded on-chain at engagement start;
        any post-freeze change reopens that contract's review.
      </P>

      <H2 n="02">Escrow — invariants & threat model</H2>
      <P>
        Holds every task's USDC until proof or ruling. Immutable, no upgrade
        path, no admin withdrawal. This is the contract users actually trust
        with capital, so its invariant list is short and absolute:
      </P>
      <Table
        head={["INVARIANT", "MUST HOLD", "TEST"]}
        rows={[
          ["I-E1", "Funds move only on matched quorum proof, or signed ruling inside fraud window", "invariant test: no code path bypasses both"],
          ["I-E2", "Σ escrowed per-task balances == contract USDC balance at all times", "stateful fuzz: random op sequences"],
          ["I-E3", "settle() is idempotent — double-settle pays once", "replay fuzz"],
          ["I-E4", "No role, key, or pause can freeze escrow beyond one ruler signature + window", "admin-key simulation: zero authority paths"],
        ]}
      />
      <Table
        head={["ATTACK", "PRECONDITION", "IMPACT", "MITIGATION", "STATUS"]}
        rows={[
          ["Reentrancy on settle hook", "attacker-controlled token callback", "double-release", "CEI order + nonReentrant; USDC has no hooks", "COVERED"],
          ["Ruling replay across rails", "same domain on two chains", "double refund on second rail", "chainId in EIP-712 domain; per-rail nullifiers", "COVERED"],
          ["Fraud-window timestamp squeeze", "miner-aligned block times", "ruling after honest window", "window measured in blocks, not seconds", "COVERED"],
          ["Commit griefing", "bond-free commits", "escrow lock DoS", "commit bond forfeited on TTL", "OPEN — bond rate under calib."],
          ["Fee rounding accumulation", "many tiny tasks", "dust accounting drift vs I-E2", "floor-fee minimum 0.01 USDC", "COVERED"],
        ]}
      />

      <H2 n="03">Settlement batcher</H2>
      <P>
        Posts Merkle roots every 30s; receipts carry inclusion proofs. Batching
        exists to amortize L1 fees, not to custody anything — the failure mode
        is withholding, not theft:
      </P>
      <Table
        head={["ATTACK", "PRECONDITION", "IMPACT", "MITIGATION", "STATUS"]}
        rows={[
          ["Root forgery by compromised batcher", "batcher hot key leaked", "false receipts anchored", "2-of-3 multisig + epoch key rotation; slashable bond", "COVERED"],
          ["Withholding / liveness failure", "batcher offline", "anchoring stalls", "anyone may force-batch after 2 missed windows (permissionless)", "COVERED"],
          ["MEV on batch inclusion", "public mempool", "root front-running", "private relay; anchor is append-only so front-run gains nothing", "COVERED"],
        ]}
      />
      <Note label="EXCLUSION">
        The USDC token contract itself is out of scope — including its own
        upgradeability risk, which the threat register tracks separately as an
        external dependency assumption.
      </Note>

      <H2 n="04">CENT token & vesting</H2>
      <P>
        Fixed supply, no mint authority, vesting locked to network epochs —
        not wall clocks — per the tokenomics design:
      </P>
      <Table
        head={["INVARIANT", "TEST"]}
        rows={[
          ["I-T1 totalSupply == 1e9 forever; mint() does not exist in bytecode", "bytecode grep + symbolic exec"],
          ["I-T2 vested(t) is monotone non-decreasing; epochs never tick backwards", "epoch oracle fuzz"],
          ["I-T3 paused network ⇒ paused vesting; no insider accrues stalled time", "epoch-freeze state machine test"],
        ]}
      />
      <Table
        head={["ATTACK", "IMPACT", "MITIGATION", "STATUS"]}
        rows={[
          ["Epoch oracle manipulation to fast-forward cliffs", "early insider unlock", "oracle = epoch counter on settlement rail, not gov-settable", "COVERED"],
          ["approve/transferFrom race (ERC-20 classic)", "allowance double-spend", "OZ ERC20 with increaseAllowance guidance in SDK", "COVERED"],
          ["Snapshot timing at epoch boundary", "claim twice on boundary reorg", "claims settle at epoch+1 state", "OPEN — formal boundary proof pending"],
        ]}
      />

      <H2 n="05">Quorum election</H2>
      <P>
        The election decides who verifies — bias here is bias everywhere.
        Determinism is the defense: the same seed must yield the same quorum
        on every recompute:
      </P>
      <Code
        label="ELECTION — DETERMINISM SPEC (AUDITOR-REPRODUCIBLE)"
        code={`seed     = keccak(blockhash(epoch_start - 2))          // past, not future
score(i) = bond_i × acc_i² × (0.75 + u_i × 0.5)         // u_i from seed
quorum   = top-3 by score, bond ≥ 25,000, not jailed

caps:    weight_ratio(quorum) ≤ 67%                     // whale capture bound
jail:    open challenge ⇒ cannot unbond or re-elect

fixtures: 40 election scenarios w/ expected quorums
          shipped in /test/fixtures/elections.json`}
      />
      <Table
        head={["ATTACK", "PRECONDITION", "IMPACT", "MITIGATION", "STATUS"]}
        rows={[
          ["Validator blockhash bias", "rail validator manipulates seed block", "steer quorum selection", "past-block seed + commit-reveal fallback", "COVERED"],
          ["Sybil grinding pre-epoch", "cheap identities in candidate pool", "crowd out honest seats", "bond floor + accuracy decays to 0 on new identity", "COVERED"],
          ["Weight overflow / rounding steer", "huge bond input", "election capture via arithmetic", "mulDiv 512-bit math; weight cap 67%", "OPEN — formal check pending"],
        ]}
      />

      <H2 n="06">Slash executor</H2>
      <Table
        head={["ATTACK", "IMPACT", "MITIGATION", "STATUS"]}
        rows={[
          ["Evidence replay — same proof, double slash", "verifier bled twice", "nullifier per evidence hash; consumed on first use", "COVERED"],
          ["Challenge griefing", "challenges spam-locked to stall unbonds", "challenger posts bond, slashed on frivolous proof", "COVERED"],
          ["Escalating slash DoS", "epoch where many proofs arrive", "slash cap per epoch; FIFO challenge queue with timeouts", "OPEN — cap value under calib."],
          ["False-evidence by compromised verifier", "honest voter burned", "challenged vote re-executed in fresh quorum before burning", "COVERED"],
        ]}
      />
      <Warn label="KNOWN RESIDUAL RISK">
        Collusion detection is heuristic (linked stake signatures + voting
        correlation). A perfect colluder leaves no trace; the mitigation is
        economic (100% bond at risk) plus challenges by any watcher. Auditors
        should attack this explicitly — it is the protocol's hardest problem.
      </Warn>

      <H2 n="07">Cross-contract systemic threats</H2>
      <Table
        head={["SURFACE", "EXPOSURE", "POSITION"]}
        rows={[
          ["Multi-rail replay", "tasks and rulings replicated across rails", "domain-separated chainIds in every signature"],
          ["USDC upgradeability", "proxy changes under escrow", "external dependency in threat register; custody never relies on USDC internals"],
          ["MEV on verdict transactions", "ruling params visible pre-inclusion", "signed rulings are payload-bound; front-running gains nothing"],
          ["Governance floor capture", "CENT holders steer fee/quorum params", "phase gates: foundation till V1.0, bounded vote, timelock 7d"],
          ["Deterministic-sandbox divergence", "spec executes differently in verify than in work", "same WASM runtime, pinned version hash, frozen syscall table"],
        ]}
      />

      <H2 n="08">Process, rubric & remediation SLA</H2>
      <Table
        head={["SEVERITY", "DEFINITION", "EXAMPLE HERE", "SLA"]}
        rows={[
          [<span className="text-red-400">CRITICAL</span>, "loss of user funds or escrow invariants broken", "I-E1/I-E2 violation", "fix + re-audit before any deployment"],
          [<span className="text-red-400">HIGH</span>, "network-wide liveness or trust compromise", "election capture, slash-grief", "fix before gate #3 completes"],
          [<span className="text-amber-300">MEDIUM</span>, "bounded loss or degraded correctness", "rounding drift, boundary snapshot", "fix before V0.3"],
          ["LOW / INFO", "hardening, clarity, gas", "event indexing, natspec", "rolling backlog"],
        ]}
      />
      <P>
        Coverage targets: 100% line coverage on Escrow and SlashExecutor
        (invariant-driven Foundry suite), ≥ 95% on all other contracts, plus
        40 deterministic election fixtures and 12 slashing scenarios shipped
        as reproducible fixtures inside each engagement's repo.
      </P>
      <Code
        label="ENGAGEMENT TIMELINE"
        code={`W1  ENG-A kickoff — capital contracts, freeze hash anchored
W3  ENG-A report — triage within 48h
W4  remediation window A (+ re-audit of patches)
W6  ENG-B kickoff — consensus contracts
W8  ENG-B report — triage within 48h
W9  remediation window B → launch gate #3 evaluation
    rule: no gate #3 until every CRITICAL and HIGH is closed`}
      />

      <div className="mt-10 border-t border-edge pt-5 font-mono text-[8.5px] leading-[1.9] tracking-[0.18em] text-mute/50">
        AUDIT CONTACT: HELLO@CIPHERSENTRY.COM · REPORTS PUBLISHED IN FULL —
        VERIFIERS DESERVE TO READ WHAT THEY BOND AGAINST.
      </div>
    </>
  );
}
