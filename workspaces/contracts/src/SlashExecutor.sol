// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/* -------------------------------------------------------------------------- */
/*  SLASH EXECUTOR — ENG-B / CONSENSUS                                        */
/*  Turns verified evidence into proportional pain (DOC-07 §06):              */
/*                                                                            */
/*  I-SE1  nullifier per evidence — replay impossible, ever                   */
/*  I-SE2  per-epoch cap is respected; overflow defers to the next epoch      */
/*  I-SE3  FIFO challenge ordering — no queue jumping, griefing pays for air  */
/*  I-SE4  slash accounting exactly matches the registry's ledger             */
/* -------------------------------------------------------------------------- */

interface IVerifierRegistrySlash {
    function slash(address verifier, uint256 amount, address payee) external;
    function bondOf(address verifier) external view returns (uint256);
}

interface IMarcSlash {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

contract SlashExecutor {
    enum Severity {
        FalseVote, // worker/denial's output failed quorum — 10% of bond
        Collusion // proven linked signatures — 100% of bond
    }

    struct Challenge {
        bytes32 evidenceHash; // canonical digest of the evidence enclosure
        address target; // the verifier losing bond
        Severity severity;
        address challenger; // paid from bountyShare if slash completes
        uint64 epoch; // epoch the evidence arrived in (cap accounting)
        uint64 at;
    }

    /* ------------------------- constants & roles ---------------------------- */

    uint256 public constant EPOCH_BLOCKS = 64;
    uint16 public constant FALSE_VOTE_BPS = 1000; // 10%
    uint16 public constant COLLUSION_BPS = 10000; // 100%
    uint256 public constant SLASH_EPOCH_CAP = 100_000 ether; // per epoch, system-wide
    uint256 public constant CHALLENGE_BOND = 2_500 ether; // griefing's cover charge

    address public constant GRAVEYARD = address(0x000000000000000000000000000000000000dEaD);

    IVerifierRegistrySlash public immutable REGISTRY;
    IMarcSlash public immutable MRC;
    address public immutable WATCHER; // posts evidence — router for challenge bonds
    address public immutable RESOLVER; // dismisses frivolous / burns griefer bond
    address public immutable TREASURY; // proceeds share lands here (25%)

    /* ----------------------------- storage ---------------------------------- */

    Challenge[] public challenges;
    uint256 public head; // FIFO cursor (I-SE3)
    mapping(bytes32 => bool) public nullifierUsed; // I-SE1
    mapping(uint64 => uint256) public slashedIn; // epoch → amount (I-SE2)
    uint256 public bondEscrow; // challenge bonds held in-flight

    /* ------------------------------ events --------------------------------- */

    event ChallengeQueued(uint256 indexed challengeId, bytes32 indexed evidenceHash, address indexed target, Severity severity, address challenger);
    event ChallengeResolved(uint256 indexed challengeId, address indexed target, uint256 slashed, uint256 burned, Severity severity);
    event ChallengeDismissed(uint256 indexed challengeId, address indexed target, address challenger);
    event ChallengerRepaid(uint256 indexed challengeId, address indexed challenger, uint256 amount);

    /* ------------------------------ errors --------------------------------- */

    error Unauthorized();
    error EvidenceReplayed(bytes32 evidenceHash);
    error ZeroAddress();
    error ZeroTarget();
    error NoChallenges();
    error EpochCapExceeded(uint256 already, uint256 amount, uint256 cap);

    /* ------------------------------ helpers --------------------------------- */

    function currentEpoch() public view returns (uint64) {
        return uint64(block.number / EPOCH_BLOCKS);
    }

    function challengeCount() external view returns (uint256) {
        return challenges.length - head;
    }

    constructor(address registry, address marcAddr, address watcher, address resolver, address treasury) {
        if (treasury == address(0)) revert ZeroAddress();
        REGISTRY = IVerifierRegistrySlash(registry);
        MRC = IMarcSlash(marcAddr);
        WATCHER = watcher;
        RESOLVER = resolver;
        TREASURY = treasury;
    }

    /* --------------------------- queue + nullifier --------------------------- */

    /// @notice Watcher submits evidence; its hash is consumed at once (I-SE1).
    ///         Challenge bond posts to the contract — it burns if evidence turns
    ///         out frivolous, returns with bounty if proven (E-LS bountyShare: 50%).
    function submitEvidence(bytes32 evidenceHash, address target, Severity severity) external returns (uint256 challengeId) {
        if (msg.sender != WATCHER) revert Unauthorized();
        if (target == address(0)) revert ZeroTarget();
        if (nullifierUsed[evidenceHash]) revert EvidenceReplayed(evidenceHash);
        nullifierUsed[evidenceHash] = true;

        // pull the challenge bond into escrow
        if (!MRC.transferFrom(msg.sender, address(this), CHALLENGE_BOND)) revert("bond pull failed");
        bondEscrow += CHALLENGE_BOND;

        challengeId = challenges.length;
        challenges.push(
            Challenge({
                evidenceHash: evidenceHash,
                target: target,
                severity: severity,
                challenger: msg.sender,
                epoch: currentEpoch(),
                at: uint64(block.timestamp)
            })
        );
        emit ChallengeQueued(challengeId, evidenceHash, target, severity, msg.sender);
    }

    /* ------------------------------- process -------------------------------- */

    /// @notice Process the FIFO head, precisely in order (I-SE3). Permissionless
    ///         caller — the protocol pays its taxes itself. Cap per epoch (I-SE2):
    ///         an amount past the remaining allowance does not vanish; it waits.
    function processNext() external {
        if (head >= challenges.length) revert NoChallenges();
        uint256 idx = head;
        Challenge storage c = challenges[idx];
        uint64 epoch = c.epoch;

        // epochs that never processed roll forward onto the current epoch's cap
        if (epoch != currentEpoch()) epoch = currentEpoch();

        uint256 bondBefore = REGISTRY.bondOf(c.target);
        uint256 cut = c.severity == Severity.FalseVote ? (bondBefore * FALSE_VOTE_BPS) / 10000 : bondBefore;

        // respect the epoch cap exactly (I-SE2) — do not truncate the slash,
        // defer it. Over-cap challenges block the queue head until next epoch.
        if (slashedIn[epoch] + cut > SLASH_EPOCH_CAP) {
            revert EpochCapExceeded(slashedIn[epoch], cut, SLASH_EPOCH_CAP);
        }

        // slash proceeds split (DOC-07 §06): 50% burn, 25% challenger bounty,
        // 25% treasury. The registry pushes `cut` to this contract first.
        uint256 burned = cut / 2;
        uint256 bounty = (cut - burned) / 2;
        uint256 treasuryShare = cut - burned - bounty;

        slashedIn[epoch] += cut;
        head += 1;

        REGISTRY.slash(c.target, cut, address(this));

        if (!MRC.transfer(GRAVEYARD, burned)) revert("burn failed");
        if (!MRC.transfer(c.challenger, CHALLENGE_BOND + bounty)) revert("challenger pay failed");
        if (treasuryShare > 0 && !MRC.transfer(TREASURY, treasuryShare)) revert("treasury pay failed");

        bondEscrow -= CHALLENGE_BOND;

        emit ChallengeResolved(idx, c.target, cut, burned, c.severity);
        emit ChallengerRepaid(idx, c.challenger, CHALLENGE_BOND + bounty);
    }

    /// @notice Resolver can throw out frivolous/empty challenges; the griefing
    ///         bond doesn't come home. Truly FIFO: a dismissal is also FIFO.
    function dismissFrivolous() external {
        if (msg.sender != RESOLVER) revert Unauthorized();
        if (head >= challenges.length) revert NoChallenges();
        uint256 idx = head;
        Challenge storage c = challenges[idx];
        head += 1;
        bondEscrow -= CHALLENGE_BOND;
        emit ChallengeDismissed(idx, c.target, c.challenger);
        if (!MRC.transfer(GRAVEYARD, CHALLENGE_BOND)) revert("burn failed");
    }

    /* ------------------------------ internals -------------------------------- */

    function severityBps(Severity sev) public pure returns (uint16) {
        return sev == Severity.FalseVote ? FALSE_VOTE_BPS : COLLUSION_BPS;
    }
}
