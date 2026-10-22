// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {VRFV2PlusClient} from "../../src/randomness/ChainlinkVRFAdapter.sol";
import {IRandomnessConsumer} from "../../src/interfaces/IRandomness.sol";

/// @notice Coordinator VRF v2.5 tiruan untuk test.
/// @dev Meniru perilaku penting VRFCoordinatorV2_5 resmi:
///      - `requestRandomWords` menerima struct `RandomWordsRequest` dan mengembalikan requestId.
///      - Callback memanggil `rawFulfillRandomWords(uint256,uint256[])` dengan gas persis `callbackGasLimit`
///        lewat low-level call, dan hanya mengembalikan `success` (coordinator tidak ikut revert).
contract MockVRFCoordinatorV2Plus {
    struct Request {
        address sender;
        bytes32 keyHash;
        uint256 subId;
        uint16 requestConfirmations;
        uint32 callbackGasLimit;
        uint32 numWords;
        bytes extraArgs;
    }

    uint256 public nextRequestId = 1000;
    mapping(uint256 => Request) internal _requests;
    uint256 public lastRequestId;

    event RandomWordsRequested(uint256 indexed requestId, address indexed sender);
    event RandomWordsFulfilled(uint256 indexed requestId, bool success);

    function requestRandomWords(VRFV2PlusClient.RandomWordsRequest calldata req)
        external
        returns (uint256 requestId)
    {
        requestId = nextRequestId++;
        _requests[requestId] = Request({
            sender: msg.sender,
            keyHash: req.keyHash,
            subId: req.subId,
            requestConfirmations: req.requestConfirmations,
            callbackGasLimit: req.callbackGasLimit,
            numWords: req.numWords,
            extraArgs: req.extraArgs
        });
        lastRequestId = requestId;
        emit RandomWordsRequested(requestId, msg.sender);
    }

    function getRequest(uint256 requestId) external view returns (Request memory) {
        return _requests[requestId];
    }

    /// @notice Penuhi request yang tercatat, dengan gas = callbackGasLimit dari request.
    function fulfill(uint256 requestId, uint256[] memory words) external returns (bool success) {
        Request memory r = _requests[requestId];
        require(r.sender != address(0), "unknown request");
        delete _requests[requestId];
        success = _callWithExactGas(r.callbackGasLimit, r.sender, requestId, words);
        emit RandomWordsFulfilled(requestId, success);
    }

    /// @notice Panggil `rawFulfillRandomWords` pada target mana pun dengan gas tertentu (untuk skenario gagal).
    function fulfillRaw(address target, uint256 requestId, uint256[] memory words, uint256 gasLimit)
        external
        returns (bool success)
    {
        success = _callWithExactGas(gasLimit, target, requestId, words);
        emit RandomWordsFulfilled(requestId, success);
    }

    function _callWithExactGas(uint256 gasLimit, address target, uint256 requestId, uint256[] memory words)
        internal
        returns (bool success)
    {
        bytes memory data = abi.encodeWithSignature("rawFulfillRandomWords(uint256,uint256[])", requestId, words);
        // Sama seperti coordinator resmi: pastikan gas yang diminta benar-benar tersedia.
        require(gasleft() - gasleft() / 64 > gasLimit + 10_000, "not enough gas");
        (success,) = target.call{gas: gasLimit}(data);
    }
}

/// @notice Consumer yang selalu revert saat menerima randomness.
contract RevertingConsumer is IRandomnessConsumer {
    function fulfillRandomness(uint256, uint256) external pure override {
        revert("boom");
    }
}

/// @notice Consumer yang menghabiskan seluruh gas yang diberikan.
contract GasBurnerConsumer is IRandomnessConsumer {
    uint256 public sink;

    function fulfillRandomness(uint256, uint256) external override {
        while (true) {
            sink++;
        }
    }
}
