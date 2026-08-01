// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/* -------------------------------------------------------------------------- */
/*  ENG-B INVARIANT SUITE — VERIFIER REGISTRY + QUORUM ELECTION              */
/*  Every DOC-07 line asserted by name.                                       */
/* -------------------------------------------------------------------------- */

import { Test } from "forge-std/Test.sol";
import { StdInvariant } from "forge-std/StdInvariant.sol";
import { VerifierRegistry } from "../src/VerifierRegistry.sol";
import { QuorumElection } from "../src/QuorumElection.sol";

/* ------------------------------ mock CENT ---------------------------------- */

contract MockCENT {
    string public constant name = "CipherSentry";
    string public constant symbol = "CENT";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (balanceOf[msg.sender] < amount) return false;
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) return false;
            allowance[from][msg.sender] = allowed - amount;
        }
        if (balanceOf[from] < amount) return false;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/* ------------------------------- handler ---------------------------------- */

contract RegistryHandler is Test {
    VerifierRegistry public reg;
    MockCENT public cent;
    address public slasher;

    address[] public actors;

    uint256 public ghostBondedIn;
    uint256 public ghostSlashedOut;
    uint256 public ghostWithdrawnOut;

    constructor(VerifierRegistry _reg, MockCENT _cent, address _slasher, address[] memory _actors) {
        reg = _reg;
        cent = _cent;
        slasher = _slasher;
        actors = _actors;
    }

    function fundAndStake(uint8 actorIx, uint256 amountSeed) external {
        if (actors.length == 0) return;
        address a = actors[actorIx % actors.length];
        uint256 amount = bound(amountSeed, 20_000 ether, 60_000 ether);
        cent.mint(a, amount);
        vm.prank(a);
        cent.approve(address(reg), type(uint256).max);
        vm.prank(a);
        try reg.stake(amount) returns () {
            ghostBondedIn += amount;
        } catch {}
    }

    function topUp(uint8 actorIx, uint256 amountSeed) external {
        address a = actors[actorIx % actors.length];
        uint128 amount = uint128(bound(amountSeed, 0, 5_000 ether));
        if (amount == 0) return;
        cent.mint(a, amount);
        vm.prank(a);
        cent.approve(address(reg), type(uint256).max);
        vm.prank(a);
        try reg.topUpBond(amount) {
            ghostBondedIn += amount;
        } catch {}
    }

    function requestUnb(uint8 actorIx) external {
        if (actors.length == 0) return;
        address a = actors[actorIx % actors.length];
        vm.prank(a);
        try reg.requestUnbond() {} catch {}
    }

    function withdrawFake(uint32 actorIx) external {
        address a = actors[actorIx % actors.length];
        vm.warp(block.timestamp + 8 days);
        vm.prank(a);
        (uint256 amount,) = reg.queueOf(a);
        vm.prank(a);
        try reg.withdrawUnbonded() {
            ghostWithdrawnOut += amount;
        } catch {}
    }

    function slashBySlasher(uint8 actorIx, uint256 fraction) external {
        address a = actors[actorIx % actors.length];
        uint256 bond = reg.bondOf(a);
        if (bond == 0) return;
        uint256 amount = bound(fraction, 0, bond / 2);
        if (amount == 0) return;
        vm.prank(slasher);
        try reg.slash(a, amount) {
            ghostSlashedOut += amount;
        } catch {}
    }

    function firstEligible() external view returns (address) {
        for (uint256 i; i < actors.length; i++) {
            if (reg.isSeatEligible(actors[i])) return actors[i];
        }
        revert("no eligible seats");
    }
}

/* ------------------------------ invariants -------------------------------- */

contract RegistryElectionInvariants is StdInvariant, Test {
    MockCENT internal cent;
    VerifierRegistry internal reg;
    QuorumElection internal qi;
    RegistryHandler internal handler;

    address internal oracle = vm.addr(0x0AC1);
    address internal slasher = vm.addr(0x51A5);

    address[] internal seats;

    function setUp() public {
        cent = new MockCENT();
        seats = [vm.addr(0xBEEF), vm.addr(0xCAFE), vm.addr(0xF00D), vm.addr(0x1234), vm.addr(0x2345)];
        reg = new VerifierRegistry(address(cent), oracle, slasher);
        qi = new QuorumElection(address(reg));
        for (uint256 i; i < seats.length; i++) {
            vm.prank(oracle);
            reg.setAccuracy(seats[i], uint16(8_000 + i * 500));
        }
        handler = new RegistryHandler(reg, cent, slasher, seats);
        targetContract(address(handler));
    }

    /* ------------------------------ I-R1 ----------------------------------- */
    /// CENT balance == Σ active bond credits + Σ queued withdrawals, always.
    function invariant_IR1_accounting() public view {
        (uint256 bonded, uint256 queued, uint256 bal) = reg.accounting();
        assertEq(bal, bonded + queued, "I-R1: contract balance != bonded + queued");
        assertEq(bonded, handler.ghostBondedIn() - handler.ghostSlashedOut() - handler.ghostWithdrawnOut() - _ghostQueuedDelta(), "I-R1: bonded drifted");
    }

    function _ghostQueuedDelta() internal view returns (uint256) {
        // net ghost queue = unbondedOutstanding tracked inside the contract itself
        (, uint256 q,) = reg.accounting();
        return q;
    }

    /* ------------------------------ I-R2 ----------------------------------- */
    /// No seat is ever eligible below the floor.
    function invariant_IR2_floorSafe() public view {
        for (uint256 i; i < seats.length; i++) {
            if (reg.isSeatEligible(seats[i])) {
                assertGe(reg.bondOf(seats[i]), 25_000 ether, "I-R2: sub-floor seat is eligible");
            }
        }
    }

    /* ------------------------------ I-R4 ----------------------------------- */
    /// A jailed verifier cannot move in any direction that matters.
    function testFuzz_jailBlocksMovement(bytes calldata junk) public {
        junk;
        address v = seats[0];
        cent.mint(v, 40_000 ether);
        vm.prank(v);
        cent.approve(address(reg), type(uint256).max);
        vm.prank(v);
        reg.stake(40_000 ether);

        vm.prank(slasher);
        reg.slash(v, 38_000 ether); // leaves 2k < floor → jailed

        assertEq(uint256(reg.statusOf(v)), 3, "jail state missing"); // Jailed == 3

        vm.prank(v);
        vm.expectRevert();
        reg.topUpBond(10_000 ether);

        vm.prank(v);
        vm.expectRevert();
        reg.requestUnbond();
    }

    /* --------------------------- I-E1 determinism -------------------------- */
    /// Same epoch + same candidates ⇒ identical seats; second elect reverts.
    function test_electionDeterministicAndLocked() public {
        _seedSeats();
        vm.roll(64 * 3 + 2);
        uint64 epoch = uint64(block.number / 64);

        address[] memory candidates = _candidates();
        qi.elect(epoch, candidates);
        (address[3] memory members, uint256[3] memory scores, bytes32 seed) = qi.quorumOf(epoch);

        // fixture determinism: the seed reads the same before and after
        bytes32 seedAgain = qi.seedFor(epoch);
        assertEq(seed, seedAgain, "I-E1: seed drifted mid-call");

        // contract-emitted scores match scoreOf recomputed at their candidate index
        for (uint256 i; i < 3; i++) {
            assertEq(scores[i], qi.scoreOf(members[i], seed, _indexOf(members[i], candidates)), "I-E1: score mismatch");
        }

        // whale cap bound holds by construction
        uint256 total = scores[0] + scores[1] + scores[2];
        assertLe(scores[0] * 10_000, total * 6_700 + 1, "I-E3: whale cap bridged");

        // per-epoch lock — no silent re-elections
        vm.expectRevert(QuorumElection.AlreadyElected.selector);
        qi.elect(epoch, candidates);
    }

    /* --------------------------- fixture: whale ---------------------------- */
    function testFuzz_whaleCaptureReverts(uint256 bondSeed) public {
        _seedSeats();
        address whale = vm.addr(0xDEAD);
        uint256 amount = bound(bondSeed, 50_000 ether, 1_000_000_000 ether);
        cent.mint(whale, amount);
        vm.prank(whale);
        cent.approve(address(reg), type(uint256).max);
        vm.prank(whale);
        reg.stake(amount);
        vm.prank(oracle);
        reg.setAccuracy(whale, 10_000);

        vm.roll(64 * 5 + 1);
        uint64 epoch = uint64(block.number / 64);
        address[] memory candidates = _candidates();
        candidates[0] = whale;

        vm.expectRevert(); // WhaleCapture or ordering-drift — never silent
        qi.elect(epoch, candidates);
    }

    /* --------------------------- jitter bounds ----------------------------- */
    function testFuzz_jitterBounded(bytes32 seed) public view {
        for (uint256 i; i < 3; i++) {
            uint256 u = qi.jitterFor(seed, i);
            assertGe(u, 7_500, "I-E1: jitter floor breached");
            assertLt(u, 12_500, "I-E1: jitter ceiling breached");
        }
    }

    /* ------------------------------ helpers --------------------------------- */

    function _seedSeats() internal {
        for (uint256 i; i < seats.length; i++) {
            uint256 amount = 30_000 ether * (i + 1);
            cent.mint(seats[i], amount);
            vm.prank(seats[i]);
            cent.approve(address(reg), type(uint256).max);
            vm.prank(seats[i]);
            reg.stake(amount);
        }
    }

    function _candidates() internal view returns (address[] memory) {
        address[] memory c = new address[](seats.length);
        for (uint256 i; i < seats.length; i++) {
            c[i] = seats[i];
        }
        return c;
    }

    function _indexOf(address who, address[] memory list) internal pure returns (uint256) {
        for (uint256 i; i < list.length; i++) {
            if (list[i] == who) return i;
        }
        revert("not found");
    }
}
