// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {DuelArena} from "../src/DuelArena.sol";

/// @notice Memastikan test vector di `test-vectors/suit-commit.json` sama persis dengan
///         `DuelArena.computeCommit`. Frontend memakai file JSON yang sama untuk unit test-nya.
contract SuitCommitVectorsTest is Test {
    string constant VECTORS = "test-vectors/suit-commit.json";
    uint256 constant VECTOR_COUNT = 6;

    function test_VectorsMatchContract() public {
        string memory json = vm.readFile(VECTORS);
        uint256 count;

        for (uint256 i; ; i++) {
            string memory p = string.concat(".vectors[", vm.toString(i), "]");
            if (!vm.keyExistsJson(json, p)) break;
            count++;

            uint256 chainId = vm.parseJsonUint(json, string.concat(p, ".chainId"));
            address arenaAddr = vm.parseJsonAddress(json, string.concat(p, ".arena"));
            address creator = vm.parseJsonAddress(json, string.concat(p, ".creator"));
            uint8 move = uint8(vm.parseJsonUint(json, string.concat(p, ".move")));
            bytes32 salt = vm.parseJsonBytes32(json, string.concat(p, ".salt"));
            bytes32 expected = vm.parseJsonBytes32(json, string.concat(p, ".commit"));
            string memory name = vm.parseJsonString(json, string.concat(p, ".name"));

            // 1. Rumus spesifikasi (bagian 2.3).
            assertEq(keccak256(abi.encode(chainId, arenaAddr, creator, move, salt)), expected, name);

            // 2. Contract sungguhan di alamat dan chain yang sama.
            vm.chainId(chainId);
            if (arenaAddr.code.length == 0) {
                deployCodeTo(
                    "DuelArena.sol:DuelArena",
                    abi.encode(address(this), address(0xFEE), uint16(250)),
                    arenaAddr
                );
            }
            assertEq(DuelArena(arenaAddr).computeCommit(creator, move, salt), expected, name);
        }

        assertEq(count, VECTOR_COUNT, "jumlah vector");
    }

    /// @dev Commit harus berubah jika salah satu input berubah (tidak ada input yang terabaikan).
    function test_EveryInputAffectsCommit() public pure {
        bytes32 base = keccak256(abi.encode(uint256(31337), address(1), address(2), uint8(1), bytes32(uint256(3))));
        assertTrue(base != keccak256(abi.encode(uint256(1), address(1), address(2), uint8(1), bytes32(uint256(3)))));
        assertTrue(base != keccak256(abi.encode(uint256(31337), address(9), address(2), uint8(1), bytes32(uint256(3)))));
        assertTrue(base != keccak256(abi.encode(uint256(31337), address(1), address(9), uint8(1), bytes32(uint256(3)))));
        assertTrue(base != keccak256(abi.encode(uint256(31337), address(1), address(2), uint8(2), bytes32(uint256(3)))));
        assertTrue(base != keccak256(abi.encode(uint256(31337), address(1), address(2), uint8(1), bytes32(uint256(4)))));
    }
}
