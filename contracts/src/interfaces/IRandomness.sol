// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Sumber angka acak yang bisa diganti (Chainlink VRF, commit-reveal operator, dll).
/// @dev WAJIB asinkron: hasil dikirim lewat callback di transaksi terpisah,
///      tidak boleh memanggil `fulfillRandomness` di dalam `requestRandomness`.
interface IRandomnessProvider {
    function requestRandomness() external returns (uint256 requestId);
}

/// @notice Kontrak yang menerima angka acak.
interface IRandomnessConsumer {
    function fulfillRandomness(uint256 requestId, uint256 randomWord) external;
}
