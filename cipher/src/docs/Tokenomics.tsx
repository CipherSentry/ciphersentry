import { H2, Kicker, Lead, Mono, Note, P, Table, Title, Ul } from "./prose";

/**
 * How CENT works — not a finished allocation sheet.
 * Fair launch: no presale, no VC token round; tokenomics TBD.
 */
export default function Tokenomics() {
  return (
    <>
      <Kicker>DOC-05 · TOKEN</Kicker>
      <Title sub="HOW IT WORKS · FAIR LAUNCH · NO TOKENOMICS TABLE YET">
        How $CENT works
      </Title>

      <Lead>
        CENT is the Cipher Sentry bond token. Agents buy work in{" "}
        <strong className="text-mist">USDC</strong>; independent sentries stake{" "}
        <strong className="text-mist">CENT</strong> so false votes have a price.
        Public listing is on{" "}
        <a
          href="https://orynth.dev"
          target="_blank"
          rel="noreferrer"
          className="text-volt underline-offset-2 hover:underline"
        >
          Orynth
        </a>
        . We have not published tokenomics.
      </Lead>

      <H2 n="01">Fair launch</H2>
      <Ul
        items={[
          <span>
            <strong className="text-mist">No presale.</strong> No private sale
            of CENT before the public mint.
          </span>,
          <span>
            <strong className="text-mist">No VC token round.</strong> No
            investor allocation, discount round, or warrant on the coin.
          </span>,
          <span>
            <strong className="text-mist">No tokenomics table yet.</strong> No
            supply splits, emission schedules, or vesting charts published as
            policy. Those land when design is real — not as marketing filler.
          </span>,
        ]}
      />
      <Note label="HONESTY">
        If a page elsewhere shows sample emission math from the console sim,
        treat it as simulation reference — not a committed distribution.
      </Note>

      <H2 n="02">Rule Zero</H2>
      <P>
        <strong className="text-mist">Work denominates in USDC. CENT is skin-in-game.</strong>{" "}
        Mixing those jobs is how protocols become casinos. Escrow, task price,
        and fee settlement stay in stable units. CENT is for bonding and
        slashing verifiers.
      </P>

      <H2 n="03">What the token does</H2>
      <Table
        head={["USE", "MECHANISM"]}
        rows={[
          ["Bond", "Stake to join the verifier set — seats require skin-in-game"],
          ["Verify", "Sentries re-execute work; matching hashes settle escrow"],
          ["Slash", "False votes / collusion burn bond to the graveyard"],
          ["Settle", "USDC releases on quorum match or a signed ruling only"],
        ]}
      />
      <P>
        Full launch surface (badge, contract card, utility):{" "}
        <Mono>#/gates</Mono> · pack <Mono>#/cent</Mono>.
      </P>

      <H2 n="04">What we are not claiming</H2>
      <Ul
        items={[
          <span>No fixed public supply schedule on this page.</span>,
          <span>No team / advisor / investor % breakdown.</span>,
          <span>No “emissions start week 0” policy until published for real.</span>,
          <span>
            Equity or project funding (if any) is separate from the fair-launch
            coin — and is not a CENT presale.
          </span>,
        ]}
      />

      <H2 n="05">After mint</H2>
      <P>
        Contract address and Solscan link publish on the launch page when live.
        Verify the address before you transact. Contact:{" "}
        <Mono>hello@ciphersentry.xyz</Mono>.
      </P>
    </>
  );
}
