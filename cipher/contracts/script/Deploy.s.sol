// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/* -------------------------------------------------------------------------- */
/*  DEPLOY.S.SOL — Cipher Sentry stack (anvil local or Base-Sepolia)          */
/*                                                                            */
/*  Deploys, in order:                                                        */
/*    (optional) MockUSDC when USDC_ADDRESS unset and LOCAL=true              */
/*    CENT · Escrow · SettlementBatcher · VestingVault                        */
/*    VerifierRegistry · QuorumElection · SlashExecutor                       */
/*                                                                            */
/*  Env:                                                                      */
/*    PRIVATE_KEY   (required)                                                */
/*    LOCAL=true    deploy MockUSDC + mint faucet; write deployments/local.json*/
/*    USDC_ADDRESS  (default Base-Sepolia Circle USDC unless LOCAL)           */
/*    TREASURY / RULER / ORACLE / WATCHER / RESOLVER                          */
/*    SIGNER_1 / SIGNER_2 / SIGNER_3  (must be distinct for batcher)         */
/*                                                                            */
/*  Local:                                                                    */
/*    anvil                                                                   */
/*    PRIVATE_KEY=0xac09…ff80 LOCAL=true forge script script/Deploy.s.sol \ */
/*      --rpc-url http://127.0.0.1:8545 --broadcast -vvvv                     */
/*                                                                            */
/*  Base-Sepolia:                                                             */
/*    PRIVATE_KEY=… forge script script/Deploy.s.sol:Deploy \                 */
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
import { MockUSDC } from "../test/mocks/MockUSDC.sol";

contract Deploy is Script {
    address constant BASE_SEPOLIA_USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    /* anvil default accounts #1 and #2 — used when LOCAL and SIGNER_* unset */
    address constant ANVIL_1 = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address constant ANVIL_2 = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;

    uint256 constant FRAUD_WINDOW = 64;
    uint256 constant EXEC_TTL = 300;
    uint256 constant BATCH_WINDOW = 15;
    uint256 constant EPOCH_BLOCKS = 64;

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
        bool local;
    }

    function loadEnv() internal view returns (Env memory e) {
        e.privateKey = vm.envUint("PRIVATE_KEY");
        e.broadcaster = vm.addr(e.privateKey);
        e.local = vm.envOr("LOCAL", false);

        e.treasury = vm.envOr("TREASURY", e.broadcaster);
        e.ruler = vm.envOr("RULER", e.broadcaster);
        e.oracle = vm.envOr("ORACLE_ADDRESS", e.broadcaster);
        e.watcher = vm.envOr("WATCHER_ADDRESS", e.broadcaster);
        e.resolver = vm.envOr("RESOLVER_ADDRESS", e.broadcaster);

        if (e.local) {
            // Distinct signers required by SettlementBatcher
            e.signers = [
                vm.envOr("SIGNER_1", e.broadcaster),
                vm.envOr("SIGNER_2", ANVIL_1),
                vm.envOr("SIGNER_3", ANVIL_2)
            ];
            // USDC filled after MockUSDC deploy in run()
            e.usdc = vm.envOr("USDC_ADDRESS", address(0));
        } else {
            e.usdc = vm.envOr("USDC_ADDRESS", BASE_SEPOLIA_USDC);
            address s1 = vm.envOr("SIGNER_1", e.broadcaster);
            address s2 = vm.envOr("SIGNER_2", s1);
            address s3 = vm.envOr("SIGNER_3", s1);
            // if all equal, force anvil-style distinct slots for dry-runs that set LOCAL=false by mistake
            if (s1 == s2 || s2 == s3 || s1 == s3) {
                s2 = ANVIL_1;
                s3 = ANVIL_2;
            }
            e.signers = [s1, s2, s3];
        }
    }

    function run() external {
        Env memory env = loadEnv();

        vm.startBroadcast(env.privateKey);

        if (env.local && env.usdc == address(0)) {
            MockUSDC mock = new MockUSDC();
            // 10M USDC faucet to broadcaster for commits
            mock.mint(env.broadcaster, 10_000_000 * 1e6);
            env.usdc = address(mock);
        }
        require(env.usdc != address(0), "USDC_ADDRESS required (or LOCAL=true)");

        CentToken cent = new CentToken(env.treasury);
        CipherSentryEscrow escrow =
            new CipherSentryEscrow(env.usdc, env.treasury, env.ruler, FRAUD_WINDOW, EXEC_TTL);
        SettlementBatcher batcher = new SettlementBatcher(env.signers, BATCH_WINDOW);
        VestingVault vault = new VestingVault(address(cent), env.treasury, EPOCH_BLOCKS);

        // registry + election + slash: slash at currentNonce+2
        uint64 slashNonce = uint64(vm.getNonce(env.broadcaster) + 2);
        address expectedSlash = vm.computeCreateAddress(env.broadcaster, slashNonce);

        VerifierRegistry registry = new VerifierRegistry(address(cent), env.oracle, expectedSlash);
        QuorumElection election = new QuorumElection(address(registry));
        SlashExecutor slash =
            new SlashExecutor(address(registry), address(cent), env.watcher, env.resolver, env.treasury);

        // local: pre-approve escrow for USDC so PROTOCOL_FROM can commit without a second tx
        if (env.local) {
            MockUSDC(env.usdc).approve(address(escrow), type(uint256).max);
        }

        vm.stopBroadcast();

        require(address(slash) == expectedSlash, "slash address prediction drifted");

        console.log("ciphersentry deploy");
        console.log("mode                 ", env.local ? "LOCAL" : "SEPOLIA");
        console.log("chainId              ", block.chainid);
        console.log("--------------------------------");
        console.log("USDC                 ", env.usdc);
        console.log("CENT                 ", address(cent));
        console.log("CipherSentryEscrow   ", address(escrow));
        console.log("SettlementBatcher    ", address(batcher));
        console.log("VestingVault         ", address(vault));
        console.log("VerifierRegistry     ", address(registry));
        console.log("QuorumElection       ", address(election));
        console.log("SlashExecutor        ", address(slash));
        console.log("broadcaster          ", env.broadcaster);

        // DEPLOY_OUT overrides; else LOCAL → local.json;
        // MOCK_USDC / mock USDC (non-Circle) on sepolia → base-sepolia-mockusdc.json
        string memory path = vm.envOr("DEPLOY_OUT", string(""));
        if (bytes(path).length == 0) {
            if (env.local) {
                // LOCAL=true on non-anvil (e.g. sepolia mock) still writes mock book when chain ≠ 31337
                if (block.chainid == 31337) path = "deployments/local.json";
                else path = "deployments/base-sepolia-mockusdc.json";
            } else {
                path = "deployments/base-sepolia.json";
            }
        }
        _writeDeployment(
            path,
            env.local,
            env.broadcaster,
            env.usdc,
            address(cent),
            address(escrow),
            address(batcher),
            address(vault),
            address(registry),
            address(election),
            address(slash)
        );
        console.log("wrote                 ", path);
        console.log("");
        console.log("gateway:");
        console.log("  ESCROW_ADDRESS     ", address(escrow));
        console.log("  BATCHER_ADDRESS    ", address(batcher));
        console.log("  PROTOCOL_FROM      ", env.broadcaster);
    }

    /// Split JSON write to avoid stack-too-deep in run().
    function _writeDeployment(
        string memory path,
        bool local,
        address deployer,
        address usdc,
        address cent,
        address escrow,
        address batcher,
        address vault,
        address registry,
        address election,
        address slash
    ) internal {
        string memory obj = "dep";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeString(obj, "mode", local ? "local" : "base-sepolia");
        vm.serializeAddress(obj, "deployer", deployer);
        vm.serializeAddress(obj, "usdc", usdc);
        vm.serializeAddress(obj, "cent", cent);
        vm.serializeAddress(obj, "escrow", escrow);
        vm.serializeAddress(obj, "batcher", batcher);
        vm.serializeAddress(obj, "vestingVault", vault);
        vm.serializeAddress(obj, "registry", registry);
        vm.serializeAddress(obj, "election", election);
        string memory out = vm.serializeAddress(obj, "slashExecutor", slash);
        vm.writeJson(out, path);
    }
}
