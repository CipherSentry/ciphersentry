// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/* -------------------------------------------------------------------------- */
/*  CENT — CIPHER SENTRY BOND TOKEN · ENG-A (capital)                          */
/*  Fixed supply. No inflation, no rebase, no surprise mints. All             */
/*  1,000,000,000 CENT are minted once to the distributor at construction;    */
/*  the bytecode contains no mint authority.                                  */
/*                                                                            */
/*  CENT exists for four verbs only: bond, slash, accrue, govern.             */
/*  Work always prices in USDC — CENT never denominates a task.               */
/*  I-T1 totalSupply == 1e9 · 10^18 forever; mint() does not exist            */
/* -------------------------------------------------------------------------- */

contract CentToken {
    string public constant name = "Cipher Sentry Bond";
    string public constant symbol = "CENT";
    uint8 public constant decimals = 18;

    uint256 public immutable totalSupply; // I-T1 — set once, never touched again

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    constructor(address distributor) {
        if (distributor == address(0)) revert("distributor = 0");
        totalSupply = 1_000_000_000 ether;
        balanceOf[distributor] = totalSupply;
        emit Transfer(address(0), distributor, totalSupply);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) return false;
            allowance[from][msg.sender] = allowed - amount;
        }
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) internal {
        if (to == address(0)) revert("to = 0");
        if (balanceOf[from] < amount) revert("balance < amount");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
