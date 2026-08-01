// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/* -------------------------------------------------------------------------- */
/*  QUORUM ELECTION — ENG-B / CONSENSUS                                       */
/*  Deterministic quorum selection. The election decides who verifies; bias   */
/*  here is bias everywhere — so every number recomputes identically anywhere */
/*  (DOC-07 §05):                                                             */
/*                                                                            */
/*   seed      = keccak(blockhash(epoch_start − 2))        // past, not future */
/*   score(i)  = bond_i × acc_i² × (0.75 + u_i × 0.5)     // u_i from seed    */
/*   quorum    = top-3 seats, bond ≥ floor, not jailed                        */
/*   cap       | seat weight ratio ≤ 67%                   // whale capture   */
/*                                                                            */
/*  I-E1  same epoch + same candidates ⇒ identical seats, everywhere         */
/*  I-E2  elections are locked at most once per epoch                         */
/*  I-E3  any quorum's single weight stays ≤ 67% of quorum weight             */
/* -------------------------------------------------------------------------- */

interface IVerifierRegistryRead {
    function weightComponents(address verifier) external view returns (uint256 bond, uint16 accBps);
    function isSeatEligible(address verifier) external view returns (bool);
    function BOND_FLOOR() external view returns (uint256);
}

contract QuorumElection {
    /* ----------------------------- constants -------------------------------- */

    uint256 public constant EPOCH_BLOCKS = 64; // ever-present in the whitepaper
    uint256 public constant TOP_SEATS = 3; // unanimity required to settle
    uint256 public constant WHALE_CAP_BPS = 6_700; // 67% of quorum weight
    uint16 public constant MAX_BPS = 10_000;
    uint256 public constant JITTER_MIN = 7_500; // factor × 0.75
    uint256 public constant JITTER_SPAN = 5_000; // + (0.00–0.50)

    IVerifierRegistryRead public immutable REGISTRY;

    /* ----------------------------- storage --------------------------------- */

    struct Election {
        // field order mirrors quorumOf()'s return tuple so the public getter
        // and explicit accessor never disagree
        address[3] members;
        uint256[3] scores;
        bytes32 seed;
        uint64 electedAt;
        bool finalized;
    }

    mapping(uint64 => Election) public elections;
    uint64 public lastElectedEpoch;

    /* ------------------------------ events --------------------------------- */

    event ElectionFinalized(
        uint64 indexed epoch,
        bytes32 seed,
        address[3] members,
        uint256[3] scores
    );

    /* ------------------------------ errors --------------------------------- */

    error SeedNotAvailable(uint64 epoch);
    error AlreadyElected(uint64 epoch);
    error TooManyCandidates(uint256 got, uint256 max);
    error WhaleCapture(uint256 candidateWeight, uint256 quorumWeight);
    error EmptyLedger();
    error NotEligible(address candidate);

    /* -------------------------- constructor -------------------------------- */

    constructor(address registry) {
        REGISTRY = IVerifierRegistryRead(registry);
        lastElectedEpoch = type(uint64).max; // sentinel: nothing elected
    }

    /* ------------------------------- views --------------------------------- */

    function currentEpoch() public view returns (uint64) {
        return uint64(block.number / EPOCH_BLOCKS);
    }

    /// @notice DOC-07 §05: seed = keccak(blockhash(epoch_start − 2)).
    function seedFor(uint64 epoch) public view returns (bytes32) {
        uint256 epochStart = uint256(epoch) * EPOCH_BLOCKS;
        uint256 lookback = epochStart >= 2 ? epochStart - 2 : 0;
        bytes32 h = blockhash(lookback);
        if (h == bytes32(0)) revert SeedNotAvailable(epoch);
        return keccak256(abi.encodePacked(h));
    }

    /// @notice Jitter stream: u_i ∈ [0.75, 1.25), deterministic per (seed, index).
    function jitterFor(bytes32 seed, uint256 index) public pure returns (uint256) {
        return JITTER_MIN + (uint256(keccak256(abi.encodePacked(seed, index))) % JITTER_SPAN);
    }

    /// @notice The exact scoring formula from DOC-07 §05.
    function scoreOf(address candidate, bytes32 seed, uint256 index) public view returns (uint256) {
        (uint256 bond, uint16 accBps) = REGISTRY.weightComponents(candidate);
        if (bond == 0 || accBps == 0) return 0;
        uint256 u = jitterFor(seed, index);
        // bond × (acc/10_000)² × (u/10_000) — 512-headroom via staged divisions
        return (((bond * uint256(accBps)) / uint256(MAX_BPS)) * uint256(accBps) * uint256(u)) / (uint256(MAX_BPS) * uint256(MAX_BPS));
    }

    /* ------------------------------ election ------------------------------- */

    /// @notice Run one epoch's election. Caller supplies candidates (registry seats).
    ///         Determinism is contract-enforced: same epoch + same order ⇒ same
    ///         output, recomputable by auditors byte-for-byte (fixture set in repo).
    function elect(uint64 epoch, address[] calldata candidates) external {
        Election storage ex = elections[epoch];
        if (ex.finalized) revert AlreadyElected(epoch);
        if (candidates.length > 64) revert TooManyCandidates(candidates.length, 64);
        if (candidates.length < TOP_SEATS) revert EmptyLedger();

        bytes32 seed = seedFor(epoch);

        // compute scores; eligibility is hardened here, not assumed
        uint256 n = candidates.length;
        uint256[] memory scores = new uint256[](n);
        for (uint256 i; i < n; i++) {
            if (!REGISTRY.isSeatEligible(candidates[i])) revert NotEligible(candidates[i]);
            scores[i] = scoreOf(candidates[i], seed, i);
        }

        // top-3 selection — tiny n, plain argmax x3 is explicit and audit-friendly
        uint256[3] memory topScores;
        address[3] memory topAddrs;
        bool[64] memory chosen;

        for (uint256 seat; seat < TOP_SEATS; seat++) {
            uint256 best;
            uint256 bestIdx = type(uint256).max;
            for (uint256 i; i < n; i++) {
                if (chosen[i]) continue;
                if (scores[i] >= best && scores[i] > 0) {
                    best = scores[i];
                    bestIdx = i;
                }
            }
            if (bestIdx == type(uint256).max) revert EmptyLedger();
            chosen[bestIdx] = true;
            topScores[seat] = best;
            topAddrs[seat] = candidates[bestIdx];
        }

        uint256 quorumWeight = topScores[0] + topScores[1] + topScores[2];
        if (topScores[0] * MAX_BPS > quorumWeight * WHALE_CAP_BPS) {
            revert WhaleCapture(topScores[0], quorumWeight);
        }

        ex.seed = seed;
        ex.members = topAddrs;
        ex.scores = topScores;
        ex.electedAt = uint64(block.number);
        ex.finalized = true;
        lastElectedEpoch = epoch;

        emit ElectionFinalized(epoch, seed, topAddrs, topScores);
    }

    /* --------------------------- quorum accessors --------------------------- */

    function quorumOf(uint64 epoch) external view returns (address[3] memory, uint256[3] memory, bytes32) {
        Election storage ex = elections[epoch];
        return (ex.members, ex.scores, ex.seed);
    }

    function isMember(uint64 epoch, address candidate) external view returns (bool) {
        Election storage ex = elections[epoch];
        return ex.members[0] == candidate || ex.members[1] == candidate || ex.members[2] == candidate;
    }
}
