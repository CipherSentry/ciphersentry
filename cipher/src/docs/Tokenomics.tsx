import { Code, H2, Kicker, Lead, Mono, Note, P, Table, Title, Ul } from "./prose";

export default function Tokenomics() {
  return (
    <>
      <Kicker>DOC-05 · TOKEN</Kicker>
      <Title sub="FIXED SUPPLY · BOND ASSET · ORYNTH TGE · WORK STAYS IN USDC">
        CENT Tokenomics
      </Title>

      <Lead>
        CENT is the Cipher Sentry bond token — stake to verify, slash on fault,
        accrue fee rebates. It never prices a task. Tasks lock and settle in
        stable USDC. The public TGE listing is on{" "}
        <a
          href="https://orynth.dev"
          target="_blank"
          rel="noreferrer"
          className="text-volt underline-offset-2 hover:underline"
        >
          Orynth
        </a>
        .
      </Lead>

      <H2 n="01">Rule Zero</H2>
      <P>
        <strong className="text-mist">Work denominates in USDC. CENT is skin-in-game.</strong>{" "}
        Agents buy and sell compute in stable units; verifiers post CENT so
        false votes have a price. Mixing those jobs is how protocols become
        casinos.
      </P>

      <H2 n="02">Supply</H2>
      <Table
        head={["PARAM", "VALUE", "NOTES"]}
        rows={[
          ["Ticker", "CENT", "Cipher Sentry Bond"],
          ["Total supply", "1,000,000,000", "Mint once at construction — no inflation authority"],
          ["Decimals", "18", "EVM ERC-20 shape (see CentToken.sol)"],
          ["Bond floor", "25,000 CENT", "Minimum stake for a verifier seat (I-R2)"],
          ["Unbond delay", "7 days", "FIFO queue per verifier (I-R3)"],
          ["TGE venue", "orynth.dev", "Product listing / public launch surface"],
        ]}
      />
      <Note label="IMMUTABLE MINT">
        <Mono>CentToken</Mono> has no <Mono>mint()</Mono>. All 1e9 · 10^18 units
        are minted to the distributor at deploy. Post-TGE, circulation is
        transfers, bonds, and burns via slash graveyard — not new issuance.
      </Note>

      <H2 n="03">Allocation (target)</H2>
      <Table
        head={["BUCKET", "%", "LOCK / VEST", "PURPOSE"]}
        rows={[
          ["Verifier emissions", "35%", "Decaying weekly schedule", "Reward honest votes over ~years"],
          ["Ecosystem / liquidity", "20%", "TGE + staged", "Orynth launch liquidity + market ops"],
          ["Team + advisors", "15%", "Cliff + linear (epoch-indexed)", "VestingVault — network time, not wall clock"],
          ["Treasury / protocol", "15%", "Governance + ops", "Audits, rails, runway"],
          ["Community / waitlist", "10%", "Bond-first unlocks", "Verifier waitlist and early operators"],
          ["Investors / warrant", "5%", "SAFE warrant terms", "See #/investors — not free float day-one"],
        ]}
      />
      <P>
        Percentages are launch design targets. Final TGE tables lock with
        counsel (G5) and the Orynth listing packet. Epoch vesting means if the
        network pauses, unlocks pause — nobody is paid for time that did not
        happen (I-V*).
      </P>

      <H2 n="04">Emissions (verifier)</H2>
      <P>
        Weekly emission curve (console / daemon reference):
      </P>
      <Code
        label="R(w) — WEEKLY CENT TO VERIFIER SET"
        code={`// week w = 0 at first mainnet epoch
R(w) = 350_000_000 * 0.0824 * 0.75^(w / 52)

// properties
// - sum converges below emissions bucket
// - decays ~25% per year of schedule
// - paid only to bonded, non-jailed seats that voted`}
      />
      <P>
        Emissions never reprice tasks. Fee rebates from the 0.35% task tax are
        separate (USDC path): 85% voting verifiers, 15% protocol treasury.
      </P>

      <H2 n="05">Utility</H2>
      <Table
        head={["USE", "MECHANISM", "FAILURE MODE"]}
        rows={[
          ["Bond", "Stake ≥ floor → Bonded seat", "Under-floor stake rejected"],
          ["Slash", "False vote / collusion → graveyard", "Replay nullifiers; epoch cap"],
          ["Elect", "Top-3 scores per epoch (bond × acc² × jitter)", "Whale cap 67% of quorum weight"],
          ["Unbond", "Request → 7d freeze → withdraw", "Jailed cannot exit until cured"],
          ["Govern signal", "Bond-weighted params (future)", "No admin path on escrow funds"],
        ]}
      />

      <H2 n="06">Orynth TGE</H2>
      <Ul
        items={[
          <span>
            Public listing surface:{" "}
            <Mono>https://orynth.dev</Mono> — product discovery + coin launch.
          </span>,
          <span>
            Protocol product page pack: <Mono>#/cent</Mono> (this site) — links,
            gates, freeze, live demo node.
          </span>,
          <span>
            G3 (two independent audits closed) and G5 (listing + legal) gate the
            TGE. G1/G2/G4 gate full permissionless mainnet, not the listing page
            itself.
          </span>,
          <span>
            Base Sepolia mock CENT is demo-only. Launch capital uses a post-audit
            mainnet deploy + Circle USDC settlement rail.
          </span>,
        ]}
      />

      <H2 n="07">Launch gates (token-relevant)</H2>
      <Table
        head={["GATE", "REQUIREMENT", "STATUS"]}
        rows={[
          ["G1", "≥ 400 bonded verifiers", "Waitlist open · #/gates"],
          ["G2", "Slashing live + auditable", "Base Sepolia write-ready"],
          ["G3", "Two audits closed (CRITICAL/HIGH)", "RFP pack ready"],
          ["G4", "60 days epoch accrual", "Counting on gates board"],
          ["G5", "Orynth listing + legal complete", "Counsel after G3 booked"],
        ]}
      />

      <H2 n="08">Source of truth</H2>
      <Ul
        items={[
          <span>
            Contract: <Mono>cipher/contracts/src/CENT.sol</Mono> · Vesting:{" "}
            <Mono>VestingVault.sol</Mono>
          </span>,
          <span>
            Listing pack: <Mono>#/cent</Mono> · Audit pack:{" "}
            <Mono>#/docs/audit</Mono>
          </span>,
          <span>
            Contact: <Mono>hello@ciphersentry.xyz</Mono>
          </span>,
        ]}
      />
    </>
  );
}
