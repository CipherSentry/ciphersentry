// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/* Minimal redeploy: VerifierRegistry + SlashExecutor with new WATCHER/RESOLVER.
 * Reuses existing CENT. Escrow/Batcher/USDC stay on the live mock stack.
 *
 * Env: PRIVATE_KEY, CENT_ADDRESS, WATCHER_ADDRESS, RESOLVER_ADDRESS,
 *      TREASURY (optional), ORACLE_ADDRESS (optional)
 */
import { Script, console } from "forge-std/Script.sol";
import { VerifierRegistry } from "../src/VerifierRegistry.sol";
import { SlashExecutor } from "../src/SlashExecutor.sol";

contract DeploySlashRegistry is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address broadcaster = vm.addr(pk);
        address cent = vm.envAddress("CENT_ADDRESS");
        address watcher = vm.envOr("WATCHER_ADDRESS", broadcaster);
        address resolver = vm.envOr("RESOLVER_ADDRESS", broadcaster);
        address treasury = vm.envOr("TREASURY", broadcaster);
        address oracle = vm.envOr("ORACLE_ADDRESS", broadcaster);

        // registry CREATE uses current nonce; slash is nonce+1
        uint64 slashNonce = uint64(vm.getNonce(broadcaster) + 1);
        address expectedSlash = vm.computeCreateAddress(broadcaster, slashNonce);

        vm.startBroadcast(pk);
        VerifierRegistry registry = new VerifierRegistry(cent, oracle, expectedSlash);
        SlashExecutor slash =
            new SlashExecutor(address(registry), cent, watcher, resolver, treasury);
        vm.stopBroadcast();

        require(address(slash) == expectedSlash, "slash address prediction drifted");

        console.log("VerifierRegistry", address(registry));
        console.log("SlashExecutor   ", address(slash));
        console.log("WATCHER         ", watcher);
        console.log("RESOLVER        ", resolver);
        console.log("CENT            ", cent);
    }
}
