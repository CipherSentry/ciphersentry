// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/* -------------------------------------------------------------------------- */
/*  DEPLOY.S.SOL — Base-Sepolia broadcast for the CipherSentry stack             */
/*                                                                            */
/*  Deploys, in order:                                                        */
/*    CENT (fixed supply → distributor)                                       */
/*    CipherSentryEscrow (USDC commitments)                                      */
/*    SettlementBatcher (2-of-3 anchors)                                      */
/*    VestingVault (epoch-indexed)                                            */
/*    VerifierRegistry (bond floor)                                           */
/*    QuorumElection                                                          */
/*    SlashExecutor (slash role is predicted and asserted post-deploy)        */
/*                                                                            */
/*  Env expected:                                                             */
/*    PRIVATE_KEY            (broadcaster — dev key only for sepolia)         */
/*    USDC_ADDRESS           (default: Base-Sepolia Circle USDC)              */
/*    TREASURY / RULER / OPERATOR_ADDRESS  (default: broadcaster)             */
/*    ORACLE / WATCHER / RESOLVER_ADDRESS   (default: broadcaster)            */
/*    SIGNER_1 / SIGNER_2 / SIGNER_3        (default: broadcaster ×3, dev)    */
/*                                                                            */
/*  Run:                                                                      */
/*    forge script script/Deploy.s.sol:Deploy \                               */
/*      --rpc-url $BASE_SEPOLIA_RPC --broadcast --verify -vvvv                */
/* -------------------------------------------------------------------------- */

import { Script, console } from "forge-std/Script.sol";
import { CentToken } from "../src/CENT.sol";
import { CipherSentryEscrow } from "../src/Escrow.sol";
import { SettlementBatcher } from "../src/SettlementBatcher.sol";
import { VestingVault } from "../src/VestingVault.sol";
import { VerifierRegistry } from "../src/VerifierRegistry.sol";
import { QuorumElection } from "../src/QuorumElection.sol";
import { SlashExecutor } from "../src/SlashExecutor.sol";

contract Deploy is Script {
    /* ------------------------- chain consts --------------------------------- */

    address constant BASE_SEPOLIA_USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    uint256 constant FRAUD_WINDOW = 64; // blocks
    uint256 constant EXEC_TTL = 300; // seconds
    uint256 constant BATCH_WINDOW = 15; // blocks (~30s on Base)
    uint256 constant EPOCH_BLOCKS = 64; // aligns across the stack
    address constant TREASURY_FALLBACK = address(0);

    /* ------------------------- environment -------------------------------- */

    struct Env {
        address broadcaster;
        address usdc;
        address treasury;
        address ruler;
        address oracle;
        address watcher;
        address resolver;
        address[3] signers;
        uint256 privateKey;
    }

    function loadEnv() internal view returns (Env memory e) {
        e.privateKey = vm.envUint("PRIVATE_KEY");
        e.broadcaster = vm.addr(e.privateKey);

        e.usdc = vm.envOr("USDC_ADDRESS", BASE_SEPOLIA_USDC);
        e.treasury = vm.envOr("TREASURY", e.broadcaster);
        e.ruler = vm.envOr("RULER", e.broadcaster);
        e.oracle = vm.envOr("ORACLE_ADDRESS", e.broadcaster);
        e.watcher = vm.envOr("WATCHER_ADDRESS", e.broadcaster);
        e.resolver = vm.envOr("RESOLVER_ADDRESS", e.broadcaster);

        address s1 = vm.envOr("SIGNER_1", e.broadcaster);
        address s2 = vm.envOr("SIGNER_2", s1);
        address s3 = vm.envOr("SIGNER_3", s1);
        e.signers = [s1, s2, s3];
    }

    /* ------------------------------- deploy ---------------------------------- */

    function run() external {
        Env memory env = loadEnv();

        vm.startBroadcast(env.privateKey);

        // 1 ─ CENT: fixed supply minted once to the distributor (broadcaster, dev).
        CentToken cent = new CentToken(env.treasury);

        // 2 ─ Escrow: task money; immutable, no pause, no upgrade path.
        CipherSentryEscrow escrow = new CipherSentryEscrow(env.usdc, env.treasury, env.ruler, FRAUD_WINDOW, EXEC_TTL);

        // 3 ─ SettlementBatcher: 2-of-3 anchor authority.
        SettlementBatcher batcher = new SettlementBatcher(_slots(env.signers), BATCH_WINDOW);

        // 4 ─ VestingVault: epoch-indexed vesting, monotone, capped.
        VestingVault vault = new VestingVault(address(cent), env.treasury, EPOCH_BLOCKS);

        // 5 ─ VerifierRegistry needs SlashExecutor's future address as its slasher.
        //     Deployments below consume one nonce each (CENT #1 … registry #5,
        //     election #6, slash #7) — compute the slash address at nonce+2 and
        //     assert post-deploy that the prediction held.
        uint64 slashNonce = vm.getNonce(env.broadcaster) + 2;
        address expectedSlash = vm.computeCreateAddress(env.broadcaster, slashNonce);

        VerifierRegistry registry = new VerifierRegistry(address(cent), env.oracle, expectedSlash);
        QuorumElection election = new QuorumElection(address(registry));

        // 6 ─ SlashExecutor (predicted nonce consumed here)
        SlashExecutor slash = new SlashExecutor(address(registry), address(cent), env.watcher, env.resolver, env.treasury);

        vm.stopBroadcast();

        /* ----------------------- assertions + receipts ----------------------- */

        require(address(slash) == expectedSlash, "slash address prediction drifted");

        console.log("ciphersentry - base-sepolia deploy");
        console.log("--------------------------------");
        console.log("CENT                ", address(cent));
        console.log("CipherSentryEscrow     ", address(escrow));
        console.log("SettlementBatcher   ", address(batcher));
        console.log("VestingVault        ", address(vault));
        console.log("VerifierRegistry    ", address(registry));
        console.log("QuorumElection      ", address(election));
        console.log("SlashExecutor       ", address(slash));
        console.log("");
        console.log("roles");
        console.log("  treasury          ", env.treasury);
        console.log("  ruler             ", env.ruler);
        console.log("  accuracy oracle   ", env.oracle);
        console.log("  watcher           ", env.watcher);
        console.log("  resolver          ", env.resolver);
        console.log("  election registry ", address(election.REGISTRY()));
        console.log("  slasher (reg)     ", registry.SLASHER());

        console.log("");
        console.log("next: set oracle addresses into the epoch engine's bond table via setSlasher dir if rotated, verify sources on basescan with --verify, then feed the registry from the waitlist in queue order");
    }

    function _slots(address[3] memory s) private pure returns (address[3] memory) {
        return s;
    }
}
