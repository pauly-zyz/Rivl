// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

import {IRandomnessProvider, IRandomnessConsumer} from "../interfaces/IRandomness.sol";

/// @dev Salinan minimal tipe Chainlink VRF v2.5 supaya proyek tidak bergantung pada paket Chainlink.
///      VERIFIKASI terhadap dokumentasi resmi Chainlink sebelum mainnet, atau ganti dengan
///      paket resmi chainlink/contracts (VRFConsumerBaseV2Plus + VRFV2PlusClient).
library VRFV2PlusClient {
    bytes4 internal constant EXTRA_ARGS_V1_TAG = bytes4(keccak256("VRF ExtraArgsV1"));

    struct ExtraArgsV1 {
        bool nativePayment;
    }

    struct RandomWordsRequest {
        bytes32 keyHash;
        uint256 subId;
        uint16 requestConfirmations;
        uint32 callbackGasLimit;
        uint32 numWords;
        bytes extraArgs;
    }

    function _argsToBytes(ExtraArgsV1 memory extraArgs) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(EXTRA_ARGS_V1_TAG, extraArgs);
    }
}

interface IVRFCoordinatorV2Plus {
    function requestRandomWords(VRFV2PlusClient.RandomWordsRequest calldata req) external returns (uint256 requestId);
}

/// @title ChainlinkVRFAdapter — menghubungkan DuelArena ke Chainlink VRF v2.5
/// @notice Setup: buat subscription VRF, isi saldo, lalu tambahkan alamat adapter ini sebagai consumer.
contract ChainlinkVRFAdapter is IRandomnessProvider, Ownable2Step {
    IVRFCoordinatorV2Plus public coordinator;
    bytes32 public keyHash;
    uint256 public subId;
    uint16 public requestConfirmations;
    uint32 public callbackGasLimit;
    bool public nativePayment;

    address public consumer;

    event ConsumerUpdated(address consumer);
    event ConfigUpdated(
        address coordinator,
        bytes32 keyHash,
        uint256 subId,
        uint16 requestConfirmations,
        uint32 callbackGasLimit,
        bool nativePayment
    );
    /// @notice Callback ke DuelArena gagal (misal gas kurang). Duel bisa di-refund setelah timeout.
    event ForwardFailed(uint256 indexed requestId);

    error OnlyConsumer();
    error OnlyCoordinator();
    error ZeroAddress();

    constructor(
        address initialOwner,
        address coordinator_,
        bytes32 keyHash_,
        uint256 subId_,
        uint16 requestConfirmations_,
        uint32 callbackGasLimit_,
        bool nativePayment_
    ) Ownable(initialOwner) {
        _setConfig(coordinator_, keyHash_, subId_, requestConfirmations_, callbackGasLimit_, nativePayment_);
    }

    function setConsumer(address consumer_) external onlyOwner {
        if (consumer_ == address(0)) revert ZeroAddress();
        consumer = consumer_;
        emit ConsumerUpdated(consumer_);
    }

    function setConfig(
        address coordinator_,
        bytes32 keyHash_,
        uint256 subId_,
        uint16 requestConfirmations_,
        uint32 callbackGasLimit_,
        bool nativePayment_
    ) external onlyOwner {
        _setConfig(coordinator_, keyHash_, subId_, requestConfirmations_, callbackGasLimit_, nativePayment_);
    }

    /// @inheritdoc IRandomnessProvider
    function requestRandomness() external override returns (uint256 requestId) {
        if (msg.sender != consumer) revert OnlyConsumer();
        requestId = coordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: keyHash,
                subId: subId,
                requestConfirmations: requestConfirmations,
                callbackGasLimit: callbackGasLimit,
                numWords: 1,
                extraArgs: VRFV2PlusClient._argsToBytes(VRFV2PlusClient.ExtraArgsV1({nativePayment: nativePayment}))
            })
        );
    }

    /// @notice Dipanggil oleh VRF Coordinator. Tidak pernah revert setelah lolos cek pengirim.
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external {
        if (msg.sender != address(coordinator)) revert OnlyCoordinator();
        if (randomWords.length == 0) {
            emit ForwardFailed(requestId);
            return;
        }
        try IRandomnessConsumer(consumer).fulfillRandomness(requestId, randomWords[0]) {}
        catch {
            emit ForwardFailed(requestId);
        }
    }

    function _setConfig(
        address coordinator_,
        bytes32 keyHash_,
        uint256 subId_,
        uint16 requestConfirmations_,
        uint32 callbackGasLimit_,
        bool nativePayment_
    ) internal {
        if (coordinator_ == address(0)) revert ZeroAddress();
        coordinator = IVRFCoordinatorV2Plus(coordinator_);
        keyHash = keyHash_;
        subId = subId_;
        requestConfirmations = requestConfirmations_;
        callbackGasLimit = callbackGasLimit_;
        nativePayment = nativePayment_;
        emit ConfigUpdated(
            coordinator_, keyHash_, subId_, requestConfirmations_, callbackGasLimit_, nativePayment_
        );
    }
}
