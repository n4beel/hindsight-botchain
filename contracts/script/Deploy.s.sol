// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {Script, console2} from "forge-std/Script.sol";
import {Hindsight} from "../src/Hindsight.sol";

/// @notice Deploys Hindsight contract and prints env configurations.
contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        vm.startBroadcast(deployerKey);
        Hindsight deployed = new Hindsight();
        vm.stopBroadcast();

        address deployedAddress = address(deployed);

        console2.log("chain id        ", block.chainid);
        console2.log("contract        ", deployedAddress);
        console2.log("");
        console2.log("Add to .env.local:");
        console2.log(
            string.concat(
                "NEXT_PUBLIC_CONTRACT_", vm.toString(block.chainid), "=", vm.toString(deployedAddress)
            )
        );
        uint256 startBlock = block.number > 1 ? block.number - 1 : 1;
        console2.log(
            string.concat(
                "NEXT_PUBLIC_DEPLOY_BLOCK_", vm.toString(block.chainid), "=", vm.toString(startBlock)
            )
        );
    }
}
