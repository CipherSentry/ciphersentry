// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/* -------------------------------------------------------------------------- */
/*  VESTING VAULT — ENG-A (capital)                                           */
/*  Epoch-indexed vesting (DOC-05 / DOC-07 §04): insider unlocks are measured */
/*  in network time, not wall clocks. If the network pauses, vesting pauses.  */
/*  Nobody gets paid for network time that didn't happen.                     */
/*                                                                            */
/*  I-V1  vested(e) is monotone non-decreasing in epoch                       */
/*  I-V2  zero before cliff; linear from cliff; capped at grant               */
/*  I-V3  claimed + claimable ≤ grant.at — over-release impossible            */
/* -------------------------------------------------------------------------- */

interface IMarc {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract VestingVault {
    struct Grant {
        address beneficiary;
        uint96 amount; // MARC, 18 decimals
        uint96 cliff; // first epoch anything vests
        uint96 linear; // epochs over which it vests after cliff
        uint96 claimed;
    }

    uint256 public immutable EPOCH_BLOCKS;
    IMarc public immutable MRC;
    address public immutable GRANTOR;

    mapping(uint256 => Grant) public grants;
    uint256 public grantCount;

    event GrantWritten(uint256 indexed id, address indexed beneficiary, uint96 amount, uint96 cliff, uint96 linear);
    event Claimed(uint256 indexed id, address indexed beneficiary, uint96 amount, uint96 claimed);

    error Unauthorized();
    error ZeroAmount();
    error ZeroBeneficiary();
    error BadSchedule();
    error NothingVested();
    error OverRelease();

    constructor(address marc_, address grantor_, uint256 epochBlocks) {
        MRC = IMarc(marc_);
        GRANTOR = grantor_;
        EPOCH_BLOCKS = epochBlocks == 0 ? 64 : epochBlocks;
    }

    function currentEpoch() public view returns (uint64) {
        return uint64(block.number / EPOCH_BLOCKS);
    }

    /// @notice Grantor delivers a grant. Immutable after creation — grants
    /// cannot be clawed back; the ledger of rights is final.
    function grant(address beneficiary, uint96 amount, uint96 cliffEpochs, uint96 linearEpochs) external returns (uint256 id) {
        if (msg.sender != GRANTOR) revert Unauthorized();
        if (beneficiary == address(0)) revert ZeroBeneficiary();
        if (amount == 0) revert ZeroAmount();
        if (linearEpochs == 0) revert BadSchedule();

        id = grantCount++;
        uint96 cliff = uint96(currentEpoch() + cliffEpochs);
        grants[id] = Grant({ beneficiary: beneficiary, amount: amount, cliff: cliff, linear: linearEpochs, claimed: 0 });

        emit GrantWritten(id, beneficiary, amount, cliff, linearEpochs);
    }

    /// @notice DOC-05 formula, computed at any epoch: zero before cliff,
    /// linear from cliff to cliff+linear, capped at amount.
    function vestedAt(uint256 id, uint64 epoch) public view returns (uint96) {
        Grant memory g = grants[id];
        if (g.amount == 0) return 0;
        if (epoch <= g.cliff) return 0; // strictly before cliff+1
        uint64 past = epoch - g.cliff;
        if (past > g.linear) past = g.linear;
        // amount * past / linear — bounded integers, no Dw sequence needed
        return uint96((uint256(g.amount) * uint256(past)) / uint256(g.linear));
    }

    function claimable(uint256 id) external view returns (uint96) {
        return vestedAt(id, currentEpoch()) - grants[id].claimed;
    }

    /// @notice Beneficiary pulls vested tranches. Any epoch can be claimed in.
    ///         Arithmetic ordering means over-release is impossible (I-V3).
    function claim(uint256 id) external {
        Grant storage g = grants[id];
        if (msg.sender != g.beneficiary) revert Unauthorized();
        uint96 vested = vestedAt(id, currentEpoch());
        uint96 due = vested - g.claimed;
        if (due == 0) revert NothingVested();

        g.claimed = vested;
        if (g.claimed > g.amount) revert OverRelease();
        emit Claimed(id, g.beneficiary, due, g.claimed);
        if (!MRC.transfer(g.beneficiary, due)) revert("pay");
    }

    /// @notice The I-V3 triple the invariant suite asserts.
    function conservation(uint256 id) external view returns (uint96 amount, uint96 claimed, uint96 vestedNow, uint96 claimableNow) {
        Grant memory g = grants[id];
        uint96 v = vestedAt(id, currentEpoch());
        return (g.amount, g.claimed, v, v - g.claimed);
    }
}
