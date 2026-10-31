// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {QuickPayRegistry} from "../QuickPayRegistry.sol";

/// @notice Deploys QuickPayRegistry. The signer comes from a Foundry keystore or hardware wallet
///         (`--account` / `--ledger`); this script never reads a raw private key.
///
///   export USDC=<official USDC address on the target chain>
///   export REGISTRY_OWNER=<address that will hold pause rights, ideally a multisig>
///   forge script contracts/script/DeployQuickPayRegistry.s.sol \
///     --rpc-url $ARC_RPC_URL --account <keystore-name> --sender <deployer-address> --broadcast
contract DeployQuickPayRegistry is Script {
    function run() external returns (QuickPayRegistry registry) {
        address usdc = vm.envAddress("USDC");
        address owner = vm.envAddress("REGISTRY_OWNER");

        vm.startBroadcast();
        registry = new QuickPayRegistry(usdc, owner);
        vm.stopBroadcast();

        console.log("QuickPayRegistry deployed at", address(registry));
        console.log("usdc", usdc);
        console.log("owner", owner);
    }
}
