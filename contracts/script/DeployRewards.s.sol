// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {RivlRewards} from "../src/RivlRewards.sol";

/// @notice Deploy RivlRewards (klaim mingguan Daily Spin). Tidak menyentuh DuelArena.
/// @dev PRIVATE_KEY wajib; OWNER opsional (default = deployer). Owner baru harus memanggil acceptOwnership().
///      Setelah deploy: isi RIVL (dan sedikit ETH/USDG untuk pengembalian fee) ke alamat contract,
///      lalu set REWARDS_ADDRESS di indexer.
contract DeployRewards is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address owner = vm.envOr("OWNER", deployer);

        vm.startBroadcast(pk);
        RivlRewards rewards = new RivlRewards(deployer);
        if (owner != deployer) rewards.transferOwnership(owner);
        vm.stopBroadcast();

        console2.log("RivlRewards:", address(rewards));
    }
}
