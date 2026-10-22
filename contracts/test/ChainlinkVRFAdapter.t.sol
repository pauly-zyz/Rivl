// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {DuelArena} from "../src/DuelArena.sol";
import {ChainlinkVRFAdapter, VRFV2PlusClient} from "../src/randomness/ChainlinkVRFAdapter.sol";
import {
    MockVRFCoordinatorV2Plus, RevertingConsumer, GasBurnerConsumer
} from "./mocks/MockVRFCoordinatorV2Plus.sol";

contract ChainlinkVRFAdapterTest is Test {
    address constant ETH = address(0);
    uint8 constant HEADS = 0;

    bytes32 constant KEY_HASH = keccak256("test-key-hash");
    uint256 constant SUB_ID = 123456789;
    uint16 constant CONFIRMATIONS = 3;
    uint32 constant CALLBACK_GAS = 300_000;

    /// @dev Nilai resmi: bytes4(keccak256("VRF ExtraArgsV1")), dari VRFV2PlusClient di chainlink/contracts.
    bytes4 constant OFFICIAL_EXTRA_ARGS_V1_TAG = 0x92fd1338;

    MockVRFCoordinatorV2Plus coordinator;
    ChainlinkVRFAdapter adapter;
    DuelArena arena;

    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    event ForwardFailed(uint256 indexed requestId);

    function setUp() public {
        coordinator = new MockVRFCoordinatorV2Plus();
        adapter = new ChainlinkVRFAdapter(
            owner, address(coordinator), KEY_HASH, SUB_ID, CONFIRMATIONS, CALLBACK_GAS, true
        );
        arena = new DuelArena(owner, treasury, address(adapter), 250);

        vm.startPrank(owner);
        adapter.setConsumer(address(arena));
        arena.setTokenConfig(ETH, true, 0.001 ether, 10 ether);
        vm.stopPrank();

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    // ------------------------------------------------------------------
    // Helper
    // ------------------------------------------------------------------

    function _openCoinflip() internal returns (uint256 id, uint256 requestId) {
        vm.prank(alice);
        id = arena.createCoinflip{value: 1 ether}(ETH, 1 ether, HEADS);
        vm.prank(bob);
        arena.join{value: 1 ether}(id, 0);
        requestId = arena.getDuel(id).requestId;
    }

    function _words(uint256 w) internal pure returns (uint256[] memory words) {
        words = new uint256[](1);
        words[0] = w;
    }

    function _status(uint256 id) internal view returns (DuelArena.Status) {
        return arena.getDuel(id).status;
    }

    // ------------------------------------------------------------------
    // Request diteruskan dengan format resmi
    // ------------------------------------------------------------------

    function test_TagMatchesOfficialConstant() public pure {
        assertEq(VRFV2PlusClient.EXTRA_ARGS_V1_TAG, OFFICIAL_EXTRA_ARGS_V1_TAG);
        assertEq(VRFV2PlusClient.EXTRA_ARGS_V1_TAG, bytes4(keccak256("VRF ExtraArgsV1")));
    }

    function test_Request_ForwardedToCoordinator() public {
        (uint256 id, uint256 requestId) = _openCoinflip();

        assertEq(requestId, coordinator.lastRequestId(), "requestId dari coordinator");
        assertEq(arena.requestToDuel(requestId), id);
        assertEq(uint8(_status(id)), uint8(DuelArena.Status.AwaitingRandomness));

        MockVRFCoordinatorV2Plus.Request memory r = coordinator.getRequest(requestId);
        assertEq(r.sender, address(adapter), "request dikirim oleh adapter");
        assertEq(r.keyHash, KEY_HASH);
        assertEq(r.subId, SUB_ID);
        assertEq(r.requestConfirmations, CONFIRMATIONS);
        assertEq(r.callbackGasLimit, CALLBACK_GAS);
        assertEq(r.numWords, 1);
        // extraArgs = tag 4 byte + abi.encode(ExtraArgsV1{nativePayment: true})
        assertEq(r.extraArgs, abi.encodePacked(OFFICIAL_EXTRA_ARGS_V1_TAG, uint256(1)));
        assertEq(r.extraArgs.length, 36);
    }

    function test_Request_NativePaymentFalseEncoded() public {
        vm.prank(owner);
        adapter.setConfig(address(coordinator), KEY_HASH, SUB_ID, CONFIRMATIONS, CALLBACK_GAS, false);

        (, uint256 requestId) = _openCoinflip();
        MockVRFCoordinatorV2Plus.Request memory r = coordinator.getRequest(requestId);
        assertEq(r.extraArgs, abi.encodePacked(OFFICIAL_EXTRA_ARGS_V1_TAG, uint256(0)));
    }

    function test_Request_OnlyConsumer() public {
        vm.prank(carol);
        vm.expectRevert(ChainlinkVRFAdapter.OnlyConsumer.selector);
        adapter.requestRandomness();
    }

    // ------------------------------------------------------------------
    // Fulfill
    // ------------------------------------------------------------------

    function test_Fulfill_SettlesDuel() public {
        (uint256 id, uint256 requestId) = _openCoinflip();

        bool success = coordinator.fulfill(requestId, _words(2)); // genap → HEADS → alice
        assertTrue(success);

        DuelArena.Duel memory d = arena.getDuel(id);
        assertEq(uint8(d.status), uint8(DuelArena.Status.Settled));
        assertEq(d.winner, alice);
        assertEq(d.randomWord, 2);
        assertEq(arena.claimable(alice, ETH), 2 ether - 0.05 ether);
        assertEq(arena.claimable(treasury, ETH), 0.05 ether);
    }

    function test_Fulfill_OnlyCoordinator() public {
        (uint256 id, uint256 requestId) = _openCoinflip();

        vm.prank(carol);
        vm.expectRevert(ChainlinkVRFAdapter.OnlyCoordinator.selector);
        adapter.rawFulfillRandomWords(requestId, _words(2));

        // Pemain pun tidak bisa memilih hasilnya sendiri.
        vm.prank(alice);
        vm.expectRevert(ChainlinkVRFAdapter.OnlyCoordinator.selector);
        adapter.rawFulfillRandomWords(requestId, _words(2));

        // Arena juga hanya menerima dari adapter.
        vm.prank(carol);
        vm.expectRevert(DuelArena.OnlyRandomnessProvider.selector);
        arena.fulfillRandomness(requestId, 2);

        assertEq(uint8(_status(id)), uint8(DuelArena.Status.AwaitingRandomness));
    }

    function test_Fulfill_OldCoordinatorRejectedAfterConfigChange() public {
        (, uint256 requestId) = _openCoinflip();
        MockVRFCoordinatorV2Plus newCoordinator = new MockVRFCoordinatorV2Plus();

        vm.prank(owner);
        adapter.setConfig(address(newCoordinator), KEY_HASH, SUB_ID, CONFIRMATIONS, CALLBACK_GAS, true);

        vm.prank(address(coordinator));
        vm.expectRevert(ChainlinkVRFAdapter.OnlyCoordinator.selector);
        adapter.rawFulfillRandomWords(requestId, _words(2));
    }

    // ------------------------------------------------------------------
    // Callback gagal tidak membuat revert
    // ------------------------------------------------------------------

    function test_Fulfill_UnknownRequestDoesNotRevert() public {
        (uint256 id,) = _openCoinflip();

        bool success = coordinator.fulfillRaw(address(adapter), 999_999, _words(7), CALLBACK_GAS);
        assertTrue(success, "request tak dikenal tidak boleh revert");
        assertEq(uint8(_status(id)), uint8(DuelArena.Status.AwaitingRandomness));
    }

    function test_Fulfill_DoubleFulfillDoesNotRevert() public {
        (uint256 id, uint256 requestId) = _openCoinflip();
        assertTrue(coordinator.fulfill(requestId, _words(2)));

        bool success = coordinator.fulfillRaw(address(adapter), requestId, _words(1), CALLBACK_GAS);
        assertTrue(success, "fulfill kedua tidak boleh revert");
        assertEq(arena.getDuel(id).winner, alice, "hasil tidak berubah");
    }

    function test_Fulfill_EmptyWordsEmitsForwardFailed() public {
        (uint256 id, uint256 requestId) = _openCoinflip();

        vm.expectEmit(true, false, false, false, address(adapter));
        emit ForwardFailed(requestId);
        bool success = coordinator.fulfill(requestId, new uint256[](0));
        assertTrue(success);
        assertEq(uint8(_status(id)), uint8(DuelArena.Status.AwaitingRandomness));

        // Dana tidak terjebak: refund setelah batas waktu.
        vm.warp(block.timestamp + arena.randomnessTimeout() + 1);
        arena.refundStuckRandomness(id);
        assertEq(uint8(_status(id)), uint8(DuelArena.Status.Refunded));
    }

    function test_Fulfill_ConsumerRevertEmitsForwardFailed() public {
        RevertingConsumer bad = new RevertingConsumer();
        vm.prank(owner);
        adapter.setConsumer(address(bad));

        vm.expectEmit(true, false, false, false, address(adapter));
        emit ForwardFailed(42);
        bool success = coordinator.fulfillRaw(address(adapter), 42, _words(1), CALLBACK_GAS);
        assertTrue(success, "revert di consumer tidak boleh menjalar");
    }

    function test_Fulfill_ConsumerOutOfGasEmitsForwardFailed() public {
        GasBurnerConsumer burner = new GasBurnerConsumer();
        vm.prank(owner);
        adapter.setConsumer(address(burner));

        vm.expectEmit(true, false, false, false, address(adapter));
        emit ForwardFailed(43);
        bool success = coordinator.fulfillRaw(address(adapter), 43, _words(1), CALLBACK_GAS);
        assertTrue(success, "consumer kehabisan gas tidak boleh membuat adapter revert");
    }

    /// @dev Jika callbackGasLimit terlalu kecil, sisa 1/64 gas tidak cukup untuk adapter sendiri,
    ///      sehingga callback gagal di level coordinator. Coordinator tidak revert dan dana tetap
    ///      bisa di-refund setelah batas waktu. Test ini mendokumentasikan batas tersebut.
    function test_Fulfill_TooLowCallbackGas_FundsStillRecoverable() public {
        vm.prank(owner);
        adapter.setConfig(address(coordinator), KEY_HASH, SUB_ID, CONFIRMATIONS, 30_000, true);
        (uint256 id, uint256 requestId) = _openCoinflip();

        bool success = coordinator.fulfill(requestId, _words(2));
        assertFalse(success);
        assertEq(uint8(_status(id)), uint8(DuelArena.Status.AwaitingRandomness));

        vm.warp(block.timestamp + arena.randomnessTimeout() + 1);
        arena.refundStuckRandomness(id);
        assertEq(arena.claimable(alice, ETH), 1 ether);
        assertEq(arena.claimable(bob, ETH), 1 ether);
    }

    /// @dev Pastikan CALLBACK_GAS default (300k, sama dengan .env.example) cukup untuk semua jalur settle.
    function test_Fulfill_DefaultCallbackGasIsEnough() public {
        vm.prank(alice);
        uint256 id = arena.createDice{value: 1 ether}(ETH, 1 ether);
        vm.prank(bob);
        arena.join{value: 1 ether}(id, 0);
        uint256 requestId = arena.getDuel(id).requestId;

        uint256 g = gasleft();
        // 128 bit bawah = 41 → pembuat 42; 128 bit atas = 86 → penerima 87.
        assertTrue(coordinator.fulfill(requestId, _words((uint256(86) << 128) | 41)));
        assertLt(g - gasleft(), CALLBACK_GAS, "settle harus jauh di bawah callbackGasLimit");
        assertEq(uint8(_status(id)), uint8(DuelArena.Status.Settled));
    }

    function testFuzz_Fulfill_ThroughAdapter_FundsConserved(uint256 word) public {
        (uint256 id, uint256 requestId) = _openCoinflip();
        assertTrue(coordinator.fulfill(requestId, _words(word)));

        address winner = arena.getDuel(id).winner;
        assertEq(winner, word % 2 == HEADS ? alice : bob);
        assertEq(
            arena.claimable(alice, ETH) + arena.claimable(bob, ETH) + arena.claimable(treasury, ETH), 2 ether
        );
        assertEq(address(arena).balance, arena.escrowed(ETH) + arena.totalClaimable(ETH));
    }

    // ------------------------------------------------------------------
    // Admin
    // ------------------------------------------------------------------

    function test_Admin_OnlyOwner() public {
        vm.startPrank(carol);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, carol));
        adapter.setConsumer(carol);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, carol));
        adapter.setConfig(carol, KEY_HASH, SUB_ID, CONFIRMATIONS, CALLBACK_GAS, true);
        vm.stopPrank();
    }

    function test_Admin_RejectZeroAddress() public {
        vm.startPrank(owner);
        vm.expectRevert(ChainlinkVRFAdapter.ZeroAddress.selector);
        adapter.setConsumer(address(0));
        vm.expectRevert(ChainlinkVRFAdapter.ZeroAddress.selector);
        adapter.setConfig(address(0), KEY_HASH, SUB_ID, CONFIRMATIONS, CALLBACK_GAS, true);
        vm.stopPrank();
    }
}
