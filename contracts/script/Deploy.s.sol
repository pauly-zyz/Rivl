// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {DuelArena} from "../src/DuelArena.sol";
import {ChainlinkVRFAdapter} from "../src/randomness/ChainlinkVRFAdapter.sol";
import {DevRandomnessProvider} from "../src/randomness/DevRandomnessProvider.sol";

/// @notice Deploy DuelArena + sumber randomness, lalu atur ETH & USDG.
/// @dev Variabel lingkungan (lihat .env.example):
///      PRIVATE_KEY, TREASURY            wajib
///      OWNER                            opsional, default = deployer (disarankan multisig)
///      USDG                             alamat USDG di chain target (kosongkan untuk lewati)
///      VRF_COORDINATOR, VRF_KEY_HASH, VRF_SUB_ID, VRF_CONFIRMATIONS, VRF_CALLBACK_GAS, VRF_NATIVE_PAYMENT
///      Jika VRF_COORDINATOR kosong → DevRandomnessProvider dipakai (HANYA TESTNET).
contract Deploy is Script {
    uint16 constant FEE_BPS = 250; // 2,5%

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address owner = vm.envOr("OWNER", deployer);
        address treasury = vm.envAddress("TREASURY");
        address usdg = vm.envOr("USDG", address(0));
        address coordinator = vm.envOr("VRF_COORDINATOR", address(0));

        vm.startBroadcast(pk);

        ChainlinkVRFAdapter adapter;
        DevRandomnessProvider dev;
        address provider;

        if (coordinator != address(0)) {
            adapter = new ChainlinkVRFAdapter(
                deployer,
                coordinator,
                vm.envBytes32("VRF_KEY_HASH"),
                vm.envUint("VRF_SUB_ID"),
                uint16(vm.envOr("VRF_CONFIRMATIONS", uint256(1))),
                uint32(vm.envOr("VRF_CALLBACK_GAS", uint256(300_000))),
                vm.envOr("VRF_NATIVE_PAYMENT", true)
            );
            provider = address(adapter);
        } else {
            console2.log("PERINGATAN: memakai DevRandomnessProvider. HANYA UNTUK TESTNET.");
            dev = new DevRandomnessProvider();
            provider = address(dev);
        }

        DuelArena arena = new DuelArena(deployer, treasury, provider, FEE_BPS);

        if (address(adapter) != address(0)) adapter.setConsumer(address(arena));
        else dev.setConsumer(address(arena));

        // Batas awal yang konservatif. Naikkan bertahap setelah audit & bankroll treasury jelas.
        arena.setTokenConfig(address(0), true, 0.0005 ether, 0.5 ether);
        if (usdg != address(0)) {
            uint256 unit = uint256(10) ** IERC20Metadata(usdg).decimals();
            arena.setTokenConfig(usdg, true, uint128(1 * unit), uint128(1_000 * unit));
        }

        // Ownable2Step: owner baru harus memanggil acceptOwnership().
        if (owner != deployer) {
            arena.transferOwnership(owner);
            if (address(adapter) != address(0)) adapter.transferOwnership(owner);
        }

        vm.stopBroadcast();

        console2.log("DuelArena:", address(arena));
        console2.log("Randomness provider:", provider);
        if (address(adapter) != address(0)) {
            console2.log("Tambahkan adapter sebagai consumer di subscription Chainlink VRF.");
        }
    }
}
