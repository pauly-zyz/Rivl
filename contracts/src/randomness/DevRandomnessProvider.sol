// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IRandomnessProvider, IRandomnessConsumer} from "../interfaces/IRandomness.sol";

/// @title DevRandomnessProvider — HANYA untuk test lokal dan testnet
/// @notice Owner menentukan angka acak secara manual. JANGAN PERNAH dipakai di mainnet:
///         owner bisa memilih hasil setiap duel.
contract DevRandomnessProvider is IRandomnessProvider {
    address public immutable owner;
    address public consumer;
    uint256 public lastRequestId;

    event RandomnessRequested(uint256 indexed requestId);

    error OnlyOwner();
    error OnlyConsumer();

    constructor() {
        owner = msg.sender;
    }

    function setConsumer(address consumer_) external {
        if (msg.sender != owner) revert OnlyOwner();
        consumer = consumer_;
    }

    function requestRandomness() external override returns (uint256 requestId) {
        if (msg.sender != consumer) revert OnlyConsumer();
        requestId = ++lastRequestId;
        emit RandomnessRequested(requestId);
    }

    function fulfill(uint256 requestId, uint256 randomWord) external {
        if (msg.sender != owner) revert OnlyOwner();
        IRandomnessConsumer(consumer).fulfillRandomness(requestId, randomWord);
    }
}
