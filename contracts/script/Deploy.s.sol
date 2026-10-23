// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {DuelArena} from "../src/DuelArena.sol";

/// @notice Deploy DuelArena, lalu atur ETH & USDG.
/// @dev Variabel lingkungan (lihat .env.example):
///      PRIVATE_KEY, TREASURY            wajib
///      OWNER                            opsional, default = deployer (disarankan multisig)
///      USDG                             alamat USDG di chain target (kosongkan untuk lewati)
///      ETH_MAX_STAKE, USDG_MAX_STAKE    opsional, batas taruhan maks. per pemain (wei / unit token utuh)
///      Semua game memakai commit-reveal antar pemain, jadi tidak ada oracle atau operator randomness.
contract Deploy is Script {
    uint16 constant FEE_BPS = 250; // 2,5%

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address owner = vm.envOr("OWNER", deployer);
        address treasury = vm.envAddress("TREASURY");
        address usdg = vm.envOr("USDG", address(0));
        // Batas awal yang konservatif. Naikkan bertahap setelah audit.
        uint256 ethMax = vm.envOr("ETH_MAX_STAKE", uint256(0.5 ether));
        uint256 usdgMaxUnits = vm.envOr("USDG_MAX_STAKE", uint256(1_000));

        vm.startBroadcast(pk);

        DuelArena arena = new DuelArena(deployer, treasury, FEE_BPS);

        arena.setTokenConfig(address(0), true, 0.0005 ether, uint128(ethMax));
        if (usdg != address(0)) {
            uint256 unit = uint256(10) ** IERC20Metadata(usdg).decimals();
            arena.setTokenConfig(usdg, true, uint128(1 * unit), uint128(usdgMaxUnits * unit));
        }

        // Ownable2Step: owner baru harus memanggil acceptOwnership().
        if (owner != deployer) arena.transferOwnership(owner);

        vm.stopBroadcast();

        console2.log("DuelArena:", address(arena));
    }
}
