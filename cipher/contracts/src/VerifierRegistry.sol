// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/* -------------------------------------------------------------------------- */
/*  VERIFIER REGISTRY — ENG-B / CONSENSUS                                     */
/*  Holds verifier bonds. Skin-in-game must be slashable, proportional, and   */
/*  network-native (DOC-07 §04).                                              */
/*                                                                            */
/*  I-R1  Σ bond credits + unbond queue == contract CENT balance              */
/*  I-R2  no bonded seat below the 25,000 CENT floor                          */
/*  I-R3  unbonding is strictly FIFO, one queue per verifier, ≥ 7-day delay   */
/*  I-R4  a jailed verifier cannot unbond, stake, or hold a seat              */
/* -------------------------------------------------------------------------- */

interface IMarcToken {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract VerifierRegistry {
    /* ----------------------------- types ---------------------------------- */

    enum Status {
        None, // not a verifier
        Bonded, // active, holds a seat
        Unbonding, // exiting; votes end at request, frozen until withdrawal
        Jailed // open challenge — cannot move, unbond, stake, or vote
    }

    struct UnbondReq {
        uint256 amount; // full queued amount for that verifier
        uint64 releasesAt; // block timestamp it becomes withdrawable
    }

    /* ---------------------------- constants -------------------------------- */

    uint256 public constant BOND_FLOOR = 25_000 ether; // CENT · DOC-05
    uint64 public constant UNBONDING_PERIOD = 7 days; // DOC-05

    address public constant GRAVEYARD = address(0x000000000000000000000000000000000000dEaD);

    /* ----------------------------- storage --------------------------------- */

    IMarcToken public immutable MRC;
    address public immutable ACCURACY_ORACLE; // updates accuracy bps
    address public immutable SLASHER; // SlashExecutor — the only caller of slash()

    mapping(address => uint256) public bondOf; // verifier → bonded CENT
    mapping(address => Status) public statusOf;
    mapping(address => uint16) public accuracyBps; // 0..10_000, oracle-written
    mapping(address => UnbondReq) public queueOf; // ONE entry per verifier (I-R3)
    uint256 public unbondedOutstanding; // Σ amounts queued system-wide
    uint256 public totalBonded; // Σ active bond credits — ghost for I-R1

    uint256 private _reentrancyLock;

    /* ------------------------------ events --------------------------------- */

    event Staked(address indexed verifier, uint256 amount, uint256 totalBond);
    event ToppedUp(address indexed verifier, uint256 amount, uint256 totalBond);
    event UnbondRequested(address indexed verifier, uint256 amount, uint64 releasesAt);
    event Withdrawn(address indexed verifier, uint256 amount);
    event Jailed(address indexed verifier);
    event Unjailed(address indexed verifier);
    event Slashed(address indexed verifier, uint256 amount, uint256 remainingBond);
    event AccuracySet(address indexed verifier, uint16 bps);

    /* ------------------------------ errors --------------------------------- */

    error Reentrant();
    error Unauthorized();
    error ZeroAddress();
    error UnderFloor(uint256 floor);
    error BadState(Status have, Status want);
    error ZeroAmount();
    error AlreadyQueued();
    error TooEarly(uint64 releasesAt);
    error SlashExceedsBond(uint256 bond, uint256 amount);
    error PullFailed();
    error PushFailed();

    /* --------------------------- modifiers --------------------------------- */

    modifier nonReentrant() {
        if (_reentrancyLock != 0) revert Reentrant();
        _reentrancyLock = 1;
        _;
        _reentrancyLock = 0;
    }

    modifier notJailed() {
        if (statusOf[msg.sender] == Status.Jailed) revert BadState(Status.Jailed, Status.Bonded);
        _;
    }

    /* -------------------------- constructor -------------------------------- */

    constructor(address cent, address accuracyOracle, address slasher) {
        if (cent == address(0) || accuracyOracle == address(0) || slasher == address(0)) revert ZeroAddress();
        MRC = IMarcToken(cent);
        ACCURACY_ORACLE = accuracyOracle;
        SLASHER = slasher;
    }

    /* ------------------------------- stake --------------------------------- */

    /// @notice Seed a verifier bond. First-time seat must clear the floor in one call.
    function stake(uint256 amount) external nonReentrant notJailed {
        Status st = statusOf[msg.sender];
        if (st == Status.Unbonding) revert BadState(st, Status.Bonded);
        uint256 total = bondOf[msg.sender] + amount;
        if (st == Status.None && total < BOND_FLOOR) revert UnderFloor(BOND_FLOOR);
        _pull(msg.sender, amount);

        bondOf[msg.sender] = total;
        totalBonded += amount;
        statusOf[msg.sender] = Status.Bonded;
        emit Staked(msg.sender, amount, total);
    }

    /// @notice Existing seat top-ups may be any positive amount.
    function topUpBond(uint256 amount) external nonReentrant notJailed {
        if (amount == 0) revert ZeroAmount();
        if (statusOf[msg.sender] != Status.Bonded) revert BadState(statusOf[msg.sender], Status.Bonded);
        _pull(msg.sender, amount);
        bondOf[msg.sender] += amount;
        totalBonded += amount;
        emit ToppedUp(msg.sender, amount, bondOf[msg.sender]);
    }

    /* ------------------------------- unbond -------------------------------- */

    /// @notice Request exit. Seats are ceded immediately (election reads
    ///         status); funds stay frozen for the full period. One queue per
    ///         verifier — second calls revert until the first withdraws (I-R3).
    function requestUnbond() external {
        if (statusOf[msg.sender] != Status.Bonded) revert BadState(statusOf[msg.sender], Status.Bonded);
        if (queueOf[msg.sender].amount != 0) revert AlreadyQueued();

        uint256 amount = bondOf[msg.sender];
        queueOf[msg.sender] = UnbondReq({ amount: amount, releasesAt: uint64(block.timestamp) + UNBONDING_PERIOD });
        totalBonded -= amount;
        unbondedOutstanding += amount;
        statusOf[msg.sender] = Status.Unbonding;
        emit UnbondRequested(msg.sender, amount, queueOf[msg.sender].releasesAt);
    }

    /// @notice Withdraw everything that finished the freezing clock.
    function withdrawUnbonded() external nonReentrant notJailed {
        if (statusOf[msg.sender] != Status.Unbonding) revert BadState(statusOf[msg.sender], Status.Unbonding);
        UnbondReq memory q = queueOf[msg.sender];
        if (block.timestamp < q.releasesAt) revert TooEarly(q.releasesAt);

        delete queueOf[msg.sender];
        unbondedOutstanding -= q.amount;
        statusOf[msg.sender] = Status.None;
        delete bondOf[msg.sender];
        emit Withdrawn(msg.sender, q.amount);
        _push(msg.sender, q.amount);
    }

    /* ------------------------------ slashing ------------------------------- */

    /// @notice Slash a verifier's bond to the graveyard — call the two-arg
    ///         overload when the whole cut is burned in one pass.
    function slash(address verifier, uint256 amount) external nonReentrant {
        _slash(verifier, amount, GRAVEYARD);
    }

    /// @notice Slash with a payee — the SlashExecutor routes proceeds to split
    ///         bounties, burns, and treasury according to fixed shares.
    function slash(address verifier, uint256 amount, address payee) external nonReentrant {
        if (payee == address(0)) revert ZeroAddress();
        _slash(verifier, amount, payee);
    }

    function _slash(address verifier, uint256 amount, address payee) internal {
        if (msg.sender != SLASHER) revert Unauthorized();
        uint256 bond = bondOf[verifier];
        if (amount > bond) revert SlashExceedsBond(bond, amount);

        // punishable surface is active bond only (DOC-07 §06);
        // queued-but-frozen withdrawals are never re-captured.
        bondOf[verifier] = bond - amount;
        totalBonded -= amount;
        if (bondOf[verifier] < BOND_FLOOR && statusOf[verifier] != Status.Unbonding) {
            statusOf[verifier] = Status.Jailed;
            emit Jailed(verifier);
        }
        emit Slashed(verifier, amount, bondOf[verifier]);
        _push(payee, amount);
    }

    function unjail(address verifier) external {
        if (msg.sender != ACCURACY_ORACLE && msg.sender != SLASHER) revert Unauthorized();
        if (bondOf[verifier] < BOND_FLOOR) revert UnderFloor(BOND_FLOOR);
        if (statusOf[verifier] != Status.Jailed) revert BadState(statusOf[verifier], Status.Jailed);
        statusOf[verifier] = bondOf[verifier] >= BOND_FLOOR ? Status.Bonded : statusOf[verifier];
        emit Unjailed(verifier);
    }

    /* ---------------------------- accuracy feed ---------------------------- */

    /// @notice Accuracy oracle writes the decayed success rate per epoch.
    function setAccuracy(address verifier, uint16 bps) external {
        if (msg.sender != ACCURACY_ORACLE) revert Unauthorized();
        if (bps > 10_000) revert BadState(Status.None, Status.None);
        accuracyBps[verifier] = bps;
        emit AccuracySet(verifier, bps);
    }

    /* ------------------------------ seat view ------------------------------- */

    /// @notice Election eligibility under DOC-07 §05: floor bond, not unbonding, not jailed.
    function isSeatEligible(address verifier) external view returns (bool) {
        return bondOf[verifier] >= BOND_FLOOR && statusOf[verifier] == Status.Bonded;
    }

    function weightComponents(address verifier) external view returns (uint256 bond, uint16 accBps) {
        return (bondOf[verifier], accuracyBps[verifier]);
    }

    /* ------------------------------ internals ------------------------------- */

    function _pull(address from, uint256 amount) internal {
        if (!MRC.transferFrom(from, address(this), amount)) revert PullFailed();
    }

    function _push(address to, uint256 amount) internal {
        if (amount == 0) return;
        if (!MRC.transfer(to, amount)) revert PushFailed();
    }

    /// @notice The I-R1 triple the invariant suite asserts:
    ///         MRC.balanceOf(this) == totalBonded + unbondedOutstanding at all times.
    function accounting() external view returns (uint256 bonded, uint256 queued, uint256 balance) {
        return (totalBonded, unbondedOutstanding, MRC.balanceOf(address(this)));
    }
}
