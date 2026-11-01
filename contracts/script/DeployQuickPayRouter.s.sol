// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {QuickPayRouter} from "../FlowPayRouter.sol";

/// @notice Deploys QuickPayRouter. The signer comes from a Foundry keystore or hardware wallet
///         (`--account` / `--ledger`); this script never reads a raw private key.
///
///   export USDC=<official USDC address on the target chain>
///   export ROUTER_OWNER=<address that will hold pause rights, ideally a multisig>
///   forge script contracts/script/DeployQuickPayRouter.s.sol \
///     --rpc-url $ARC_RPC_URL --account <keystore-name> --sender <deployer-address> --broadcast
contract DeployQuickPayRouter is Script {
    function run() external returns (QuickPayRouter router) {
        address usdc = vm.envAddress("USDC");
        address owner = vm.envAddress("ROUTER_OWNER");

        vm.startBroadcast();
        router = new QuickPayRouter(usdc, owner);
        vm.stopBroadcast();

        console.log("QuickPayRouter deployed at", address(router));
        console.log("usdc", usdc);
        console.log("owner", owner);
    }
}
