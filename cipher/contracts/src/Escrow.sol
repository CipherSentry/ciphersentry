// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/* -------------------------------------------------------------------------- */
/*  MACHINARC ESCROW — ENG-A / CAPITAL                                        */
/*  Holds every task's USDC until a matched quorum proof — or a signed        */
/*  ruling inside the fraud window. Immutable. No upgrade path. No admin      */
/*  withdrawal. This is the contract users actually trust with capital,        */
/*  so its invariant list is short and absolute (DOC-07 §02):                 */
/*                                                                            */
/*  I-E1  funds move only on matched proof or signed ruling inside window     */
/*  I-E2  Σ task amounts + bonds == contract USDC balance                     */
/*  I-E3  settle is single-shot — a task pays out exactly once                */
/*  I-E4  no role, key, or pause can freeze escrow beyond ruler sig + window  */
/* -------------------------------------------------------------------------- */

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract CipherSentryEscrow {
    /* ----------------------------- types ---------------------------------- */

    enum State {
        None, // 0 — task does not exist
        Committed, // 1 — escrow locked, awaiting worker ack
        Executing, // 2 — acknowledged; TTL running
        Verifying, // 3 — hash reported; quorum voting
        Settled, // 4 — paid out; terminal
        Disputed, // 5 — quorum mismatch; ruling slot open
        Failed // 6 — TTL expiry; refunded; terminal
    }

    enum Ruling {
        Refund, // 0 — escrow + bond back to buyer
        Release, // 1 — worker paid despite quorum dissent
        Split // 2 — amount halves between parties
    }

    struct Task {
        address buyer;
        address worker;
        uint96 amount; // USDC, 6 decimals
        uint96 bond; // commit bond, anti-griefing
        bytes32 spec;
        bytes32 reportedHash;
        State state;
        uint32 stateAt; // block.number of last transition
        uint64 ttl; // timestamp deadline for report()
        uint8 matched; // votes equal to reportedHash
        uint8 mismatched; // votes against reportedHash
        uint64 rulingNonce; // highest consumed ruling nonce
    }

    /* --------------------------- constants -------------------------------- */

    uint8 public constant QUORUM = 3; // unanimity required to settle cleanly
    uint8 public constant MISMATCH_DISPUTE = 2; // 2/3 mismatch opens dispute
    uint16 public constant FEE_BPS = 35; // 0.35% of amount → treasury
    uint256 public constant MIN_AMOUNT = 10_000; // 0.01 USDC — anti-dust floor
    uint256 public constant MIN_BOND = 10_000; // commit-bond floor

    /* ------------------------- immutables --------------------------------- */

    IERC20 public immutable USDC;
    address public immutable TREASURY;
    address public immutable RULER; // EOA that signs rulings (EIP-712)
    uint256 public immutable FRAUD_WINDOW; // blocks; ruling slot length
    uint256 public immutable EXEC_TTL; // seconds; report deadline after ack
    bytes32 private immutable DOMAIN_SEPARATOR;

    bytes32 public constant RULING_TYPEHASH = keccak256("Ruling(bytes32 taskId,uint8 ruling,uint64 nonce)");
    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EthereumEIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    /* ---------------------------- storage --------------------------------- */

    mapping(bytes32 => Task) public tasks;
    mapping(bytes32 => mapping(address => uint8)) public voteOf; // 0 none, 1 match, 2 mismatch
    mapping(address => bool) public isVerifier;

    address[] public verifierSet;
    mapping(address => uint256) private _verifierIndex;

    uint256 public totalEscrowed; // active task amounts (cleared at payout)
    uint256 public totalBonds; // active commit bonds
    uint256 public settledCount; // total terminal tasks (for I-E2 ghost sums)

    uint256 private _reentrancyLock;

    /* ---------------------------- events ---------------------------------- */

    event Committed(bytes32 indexed taskId, address indexed buyer, address indexed worker, uint96 amount, uint96 bond, bytes32 spec);
    event Acknowledged(bytes32 indexed taskId, uint64 ttl);
    event Reported(bytes32 indexed taskId, bytes32 reportedHash);
    event Voted(bytes32 indexed taskId, address indexed verifier, bool matched, uint8 matchedCount, uint8 mismatchedCount);
    event Disputed(bytes32 indexed taskId, bytes32 reportedHash, bytes32 dissentHash);
    event Settled(bytes32 indexed taskId, Ruling via, uint96 workerPay, uint96 fee, uint96 buyerRefund);
    event Failed(bytes32 indexed taskId, uint96 buyerRefund);
    event Ruled(bytes32 indexed taskId, Ruling ruling, uint64 nonce);
    event VerifierSet(address indexed verifier, bool active);

    /* ---------------------------- errors ---------------------------------- */

    error Reentrant();
    error BadState(State have, State want);
    error Unauthorized();
    error BadAmount();
    error AlreadyVoted();
    error TaskExists();
    error UnknownTask();
    error WindowClosed();
    error WindowOpen();
    error BadSignature();
    error NotUnanimous();
    error TtlRunning();
    error TtlExpired();
    error TransferFailed();
    error ZeroAddress();

    /* --------------------------- modifiers -------------------------------- */

    modifier nonReentrant() {
        if (_reentrancyLock != 0) revert Reentrant();
        _reentrancyLock = 1;
        _;
        _reentrancyLock = 0;
    }

    modifier exists(bytes32 taskId) {
        if (tasks[taskId].state == State.None) revert UnknownTask();
        _;
    }

    /* -------------------------- constructor ------------------------------- */

    constructor(address usdc, address treasury, address ruler, uint256 fraudWindowBlocks, uint256 execTtlSeconds) {
        if (usdc == address(0) || treasury == address(0) || ruler == address(0)) revert ZeroAddress();
        USDC = IERC20(usdc);
        TREASURY = treasury;
        RULER = ruler;
        FRAUD_WINDOW = fraudWindowBlocks; // e.g. 64 blocks on Base (~2 min)
        EXEC_TTL = execTtlSeconds; // e.g. 300 seconds
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256("CipherSentryEscrow"),
                keccak256("0.1"),
                block.chainid, // multi-rail replay protection (DOC-07 §07)
                address(this)
            )
        );
        _setVerifier(ruler, true); // ruler is verifier 0 by construction
    }

    /* ------------------- verifier set (ruler-managed) --------------------- */
    /* Quorum ELECTION is ENG-B (consensus scope). The capital contract only   */
    /* needs to know which addresses may vote; the ruler seeds the set.        */

    function setVerifier(address verifier, bool active) external {
        if (msg.sender != RULER) revert Unauthorized();
        _setVerifier(verifier, active);
    }

    function _setVerifier(address verifier, bool active) internal {
        bool was = isVerifier[verifier];
        if (active == was) return;
        isVerifier[verifier] = active;
        if (active) {
            _verifierIndex[verifier] = verifierSet.length;
            verifierSet.push(verifier);
        } else if (verifierSet.length > 0) {
            uint256 idx = _verifierIndex[verifier];
            address last = verifierSet[verifierSet.length - 1];
            verifierSet[idx] = last;
            _verifierIndex[last] = idx;
            verifierSet.pop();
            delete _verifierIndex[verifier];
        }
        emit VerifierSet(verifier, active);
    }

    function verifierCount() external view returns (uint256) {
        return verifierSet.length;
    }

    /* --------------------------- lifecycle -------------------------------- */

    /// @notice Buyer locks escrow + commit bond against a worker for a spec.
    function commit(bytes32 spec, address worker, uint96 amount, uint96 bond) external nonReentrant returns (bytes32 taskId) {
        if (worker == address(0) || worker == msg.sender) revert Unauthorized();
        if (amount < MIN_AMOUNT || bond < MIN_BOND) revert BadAmount();

        taskId = keccak256(abi.encodePacked(block.chainid, msg.sender, worker, spec, amount, block.number));
        if (tasks[taskId].state != State.None) revert TaskExists();

        _pull(msg.sender, uint256(amount) + uint256(bond));

        tasks[taskId] = Task({
            buyer: msg.sender,
            worker: worker,
            amount: amount,
            bond: bond,
            spec: spec,
            reportedHash: bytes32(0),
            state: State.Committed,
            stateAt: uint32(block.number),
            ttl: 0,
            matched: 0,
            mismatched: 0,
            rulingNonce: 0
        });
        totalEscrowed += amount;
        totalBonds += bond;
        emit Committed(taskId, msg.sender, worker, amount, bond, spec);
    }

    /// @notice Worker stakes its capacity by acknowledging; starts the TTL clock.
    function acknowledge(bytes32 taskId) external exists(taskId) {
        Task storage t = tasks[taskId];
        if (msg.sender != t.worker) revert Unauthorized();
        _need(t.state, State.Committed);
        t.state = State.Executing;
        t.stateAt = uint32(block.number);
        t.ttl = uint64(block.timestamp) + uint64(EXEC_TTL);
        emit Acknowledged(taskId, t.ttl);
    }

    /// @notice Worker reports the canonical output hash. Opens the quorum clock.
    function report(bytes32 taskId, bytes32 outputHash) external exists(taskId) {
        Task storage t = tasks[taskId];
        if (msg.sender != t.worker) revert Unauthorized();
        _need(t.state, State.Executing);
        if (block.timestamp > t.ttl) revert TtlExpired();
        t.reportedHash = outputHash;
        t.state = State.Verifying;
        t.stateAt = uint32(block.number);
        emit Reported(taskId, outputHash);
    }

    /// @notice Verifier votes its independently recomputed hash. One vote each.
    ///         A 2/3 mismatch escalates to Disputed in the same transaction —
    ///         after which further votes revert (state moved).
    function vote(bytes32 taskId, bytes32 recomputed) external exists(taskId) {
        Task storage t = tasks[taskId];
        if (!isVerifier[msg.sender]) revert Unauthorized();
        if (voteOf[taskId][msg.sender] != 0) revert AlreadyVoted();
        _need(t.state, State.Verifying);

        if (recomputed == t.reportedHash) {
            t.matched += 1;
            voteOf[taskId][msg.sender] = 1;
        } else {
            t.mismatched += 1;
            voteOf[taskId][msg.sender] = 2;
        }
        emit Voted(taskId, msg.sender, recomputed == t.reportedHash, t.matched, t.mismatched);

        if (t.mismatched >= MISMATCH_DISPUTE) {
            t.state = State.Disputed;
            t.stateAt = uint32(block.number);
            emit Disputed(taskId, t.reportedHash, recomputed);
        }
    }

    /* ----------------------------- settlement ------------------------------ */

    /// @notice Permissionless settle on a matched quorum. Single-shot by
    ///         state-machine construction (I-E3): the second call reverts.
    function settle(bytes32 taskId) external nonReentrant exists(taskId) {
        Task storage t = tasks[taskId];
        _need(t.state, State.Verifying);
        if (t.matched < QUORUM) revert NotUnanimous();

        (uint96 workerPay, uint96 fee_) = _payouts(t, Ruling.Release);
        uint96 bond = t.bond;
        _applyRuling(t, Ruling.Release);
        t.state = State.Settled;
        t.stateAt = uint32(block.number);
        settledCount += 1;
        emit Settled(taskId, Ruling.Release, workerPay, fee_, bond); // bond → buyer
    }

    /// @notice TTL expiry: worker acknowledged but never reported in time.
    ///         Buyer recovers amount + bond in full. Any caller may trigger.
    function timeout(bytes32 taskId) external nonReentrant exists(taskId) {
        Task storage t = tasks[taskId];
        _need(t.state, State.Executing);
        if (block.timestamp <= t.ttl) revert TtlRunning();

        uint96 refund = t.amount + t.bond;
        address buyer = t.buyer;
        uint96 amount = t.amount;
        uint96 bond = t.bond;
        t.state = State.Failed;
        t.stateAt = uint32(block.number);
        totalEscrowed -= amount;
        totalBonds -= bond;
        _push(buyer, refund);
        emit Failed(taskId, refund);
    }

    /* ------------------------------ ruling -------------------------------- */

    /// @notice Ruler-signed ruling resolves a Disputed task inside the fraud window.
    ///         EIP-712 signature with monotonic per-task nonce; chainId-separated.
    function rule(bytes32 taskId, Ruling ruling, uint64 nonce, bytes calldata sig)
        external
        nonReentrant
        exists(taskId)
    {
        Task storage t = tasks[taskId];
        _need(t.state, State.Disputed);
        if (block.number > uint256(t.stateAt) + FRAUD_WINDOW) revert WindowClosed();
        if (nonce <= t.rulingNonce) revert BadSignature();

        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR,
                keccak256(abi.encode(RULING_TYPEHASH, taskId, uint8(ruling), nonce))
            )
        );
        if (_recover(digest, sig) != RULER) revert BadSignature();
        t.rulingNonce = nonce;

        (uint96 workerPay, uint96 fee_) = _payouts(t, ruling);
        uint96 buyerRefund = ruling == Ruling.Refund ? t.amount + t.bond : (ruling == Ruling.Split ? (t.amount / 2) + t.bond : t.bond);
        _applyRuling(t, ruling);
        t.state = State.Settled;
        t.stateAt = uint32(block.number);
        settledCount += 1;
        emit Ruled(taskId, ruling, nonce);
        emit Settled(taskId, ruling, workerPay, fee_, buyerRefund);
    }

    /// @notice If no ruling lands inside the window, escrow defaults to REFUND.
    ///         I-E4 freeze bound: capital cannot stall past window + grace.
    function defaultRefund(bytes32 taskId) external nonReentrant exists(taskId) {
        Task storage t = tasks[taskId];
        _need(t.state, State.Disputed);
        if (block.number <= uint256(t.stateAt) + FRAUD_WINDOW) revert WindowOpen();

        uint96 refund = t.amount + t.bond;
        address buyer = t.buyer;
        uint96 amount = t.amount;
        uint96 bond = t.bond;
        t.state = State.Settled;
        t.stateAt = uint32(block.number);
        settledCount += 1;
        totalEscrowed -= amount;
        totalBonds -= bond;
        _push(buyer, refund);
        emit Ruled(taskId, Ruling.Refund, type(uint64).max);
        emit Settled(taskId, Ruling.Refund, 0, 0, refund);
    }

    /* --------------------------- internal pay ------------------------------ */

    /// @dev Compute payouts BEFORE clearing storage; events read these, never the cleared struct.
    function _payouts(Task storage t, Ruling ruling) internal view returns (uint96 workerPay, uint96 fee_) {
        if (ruling == Ruling.Refund) {
            return (0, 0);
        }
        if (ruling == Ruling.Release) {
            fee_ = _fee(t.amount);
            return (t.amount - fee_, fee_);
        }
        // Split: worker receives (amount - half) - fee on that share.
        uint96 workerShare = t.amount - (t.amount / 2);
        fee_ = _fee(workerShare);
        return (workerShare - fee_, fee_);
    }

    function _applyRuling(Task storage t, Ruling ruling) internal {
        uint96 amount = t.amount;
        uint96 bond = t.bond;
        address buyer = t.buyer;
        address worker = t.worker;

        totalEscrowed -= amount;
        totalBonds -= bond;

        if (ruling == Ruling.Refund) {
            _push(buyer, uint256(amount) + uint256(bond));
        } else if (ruling == Ruling.Release) {
            uint96 fee_ = _fee(amount);
            _push(worker, amount - fee_);
            _push(TREASURY, fee_);
            _push(buyer, bond);
        } else {
            uint96 half = amount / 2;
            uint96 rest = amount - half;
            uint96 fee_ = _fee(rest);
            _push(worker, rest - fee_);
            _push(TREASURY, fee_);
            _push(buyer, uint256(half) + uint256(bond));
        }
    }

    function _fee(uint96 amount) internal pure returns (uint96) {
        return (amount * FEE_BPS) / 10_000;
    }

    function _need(State have, State want) internal pure {
        if (have != want) revert BadState(have, want);
    }

    function _pull(address from, uint256 amount) internal {
        if (!USDC.transferFrom(from, address(this), amount)) revert TransferFailed();
    }

    function _push(address to, uint256 amount) internal {
        if (amount == 0) return;
        if (!USDC.transfer(to, amount)) revert TransferFailed();
    }

    /* --------------------------- eip712 utils ------------------------------ */

    function domainSeparator() external view returns (bytes32) {
        return DOMAIN_SEPARATOR;
    }

    function _recover(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        // reject malleable s values (EIP-2 lower-half order rule)
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            return address(0);
        }
        return ecrecover(digest, v, r, s);
    }

    /* ------------------------------ views ---------------------------------- */

    /// @notice The exact triple the invariant suite asserts (I-E2).
    function accounting() external view returns (uint256 escrowed, uint256 bonds, uint256 balance) {
        return (totalEscrowed, totalBonds, USDC.balanceOf(address(this)));
    }
}
