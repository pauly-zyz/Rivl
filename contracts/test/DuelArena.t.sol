// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {DuelArena} from "../src/DuelArena.sol";
import {DevRandomnessProvider} from "../src/randomness/DevRandomnessProvider.sol";
import {MockUSDG, FeeOnTransferToken, ReentrantPlayer} from "./mocks/Mocks.sol";

contract DuelArenaTest is Test {
    // Konstanta lokal (jangan panggil arena.HEADS() di dalam vm.prank — itu menghabiskan prank).
    uint8 constant HEADS = 0;
    uint8 constant TAILS = 1;
    uint8 constant ROCK = 1;
    uint8 constant PAPER = 2;
    uint8 constant SCISSORS = 3;
    uint16 constant FEE_BPS = 250;
    address constant ETH = address(0);

    DuelArena arena;
    DevRandomnessProvider vrf;
    MockUSDG usdg;

    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    function setUp() public {
        vrf = new DevRandomnessProvider();
        usdg = new MockUSDG();
        arena = new DuelArena(owner, treasury, address(vrf), FEE_BPS);
        vrf.setConsumer(address(arena));

        vm.startPrank(owner);
        arena.setTokenConfig(ETH, true, 0.001 ether, 10 ether);
        arena.setTokenConfig(address(usdg), true, 1e6, 10_000e6);
        vm.stopPrank();

        address[3] memory players = [alice, bob, carol];
        for (uint256 i; i < players.length; i++) {
            vm.deal(players[i], 100 ether);
            usdg.mint(players[i], 1_000_000e6);
            vm.prank(players[i]);
            usdg.approve(address(arena), type(uint256).max);
        }
    }

    // ------------------------------------------------------------------
    // Helper
    // ------------------------------------------------------------------

    function _fee(uint256 stake) internal pure returns (uint256) {
        return (stake * 2 * FEE_BPS) / 10_000;
    }

    function _coinflipEth(address who, uint256 amount, uint8 side) internal returns (uint256 id) {
        vm.prank(who);
        id = arena.createCoinflip{value: amount}(ETH, amount, side);
    }

    function _joinEth(address who, uint256 id, uint256 amount, uint8 move) internal {
        vm.prank(who);
        arena.join{value: amount}(id, move);
    }

    function _join(address who, uint256 id, uint8 move) internal {
        vm.prank(who);
        arena.join(id, move);
    }

    function _fulfill(uint256 id, uint256 word) internal {
        vrf.fulfill(arena.getDuel(id).requestId, word);
    }

    function _suitEth(address who, uint256 amount, uint8 move, bytes32 salt) internal returns (uint256 id) {
        bytes32 commit = arena.computeCommit(who, move, salt);
        vm.prank(who);
        id = arena.createSuit{value: amount}(ETH, amount, commit);
    }

    function _status(uint256 id) internal view returns (DuelArena.Status) {
        return arena.getDuel(id).status;
    }

    function _assertSolvent(address token) internal view {
        uint256 balance = token == ETH ? address(arena).balance : usdg.balanceOf(address(arena));
        assertEq(balance, arena.escrowed(token) + arena.totalClaimable(token), "saldo != kewajiban");
    }

    // ------------------------------------------------------------------
    // Coinflip
    // ------------------------------------------------------------------

    function test_Coinflip_Eth_CreatorWins() public {
        uint256 id = _coinflipEth(alice, 1 ether, HEADS);
        _joinEth(bob, id, 1 ether, 0);
        assertEq(uint8(_status(id)), uint8(DuelArena.Status.AwaitingRandomness));

        _fulfill(id, 2); // genap → HEADS

        DuelArena.Duel memory d = arena.getDuel(id);
        assertEq(uint8(d.status), uint8(DuelArena.Status.Settled));
        assertEq(d.winner, alice);
        assertEq(d.creatorResult, HEADS);

        uint256 fee = _fee(1 ether);
        assertEq(arena.claimable(alice, ETH), 2 ether - fee);
        assertEq(arena.claimable(treasury, ETH), fee);
        assertEq(arena.claimable(bob, ETH), 0);
        _assertSolvent(ETH);

        uint256 before = alice.balance;
        vm.prank(alice);
        arena.withdraw(ETH);
        assertEq(alice.balance, before + 2 ether - fee);
        assertEq(arena.claimable(alice, ETH), 0);
        _assertSolvent(ETH);
    }

    function test_Coinflip_Usdg_JoinerWins() public {
        vm.prank(alice);
        uint256 id = arena.createCoinflip(address(usdg), 100e6, HEADS);
        _join(bob, id, 0);
        _fulfill(id, 1); // ganjil → TAILS

        assertEq(arena.getDuel(id).winner, bob);
        assertEq(arena.claimable(bob, address(usdg)), 200e6 - _fee(100e6)); // 195 USDG
        assertEq(arena.claimable(treasury, address(usdg)), 5e6);
        _assertSolvent(address(usdg));

        uint256 before = usdg.balanceOf(treasury);
        vm.prank(treasury);
        arena.withdraw(address(usdg));
        assertEq(usdg.balanceOf(treasury), before + 5e6);
    }

    function test_Coinflip_RevertInvalidSide() public {
        vm.prank(alice);
        vm.expectRevert(DuelArena.InvalidSide.selector);
        arena.createCoinflip{value: 1 ether}(ETH, 1 ether, 2);
    }

    // ------------------------------------------------------------------
    // Dice
    // ------------------------------------------------------------------

    function _diceWord(uint256 creatorRoll, uint256 joinerRoll) internal pure returns (uint256) {
        // angka = (bagian % 100) + 1
        return ((joinerRoll - 1) << 128) | (creatorRoll - 1);
    }

    function test_Dice_HigherRollWins() public {
        vm.prank(alice);
        uint256 id = arena.createDice{value: 1 ether}(ETH, 1 ether);
        _joinEth(bob, id, 1 ether, 0);
        _fulfill(id, _diceWord(42, 87));

        DuelArena.Duel memory d = arena.getDuel(id);
        assertEq(d.creatorResult, 42);
        assertEq(d.joinerResult, 87);
        assertEq(d.winner, bob);
        assertEq(arena.claimable(bob, ETH), 2 ether - _fee(1 ether));
        _assertSolvent(ETH);
    }

    function test_Dice_TieRefundsWithoutFee() public {
        vm.prank(alice);
        uint256 id = arena.createDice{value: 1 ether}(ETH, 1 ether);
        _joinEth(bob, id, 1 ether, 0);
        _fulfill(id, _diceWord(50, 50));

        assertEq(uint8(_status(id)), uint8(DuelArena.Status.Draw));
        assertEq(arena.claimable(alice, ETH), 1 ether);
        assertEq(arena.claimable(bob, ETH), 1 ether);
        assertEq(arena.claimable(treasury, ETH), 0);
        _assertSolvent(ETH);
    }

    function testFuzz_Dice_RollsInRange(uint256 word) public {
        vm.prank(alice);
        uint256 id = arena.createDice{value: 1 ether}(ETH, 1 ether);
        _joinEth(bob, id, 1 ether, 0);
        _fulfill(id, word);

        DuelArena.Duel memory d = arena.getDuel(id);
        assertGe(d.creatorResult, 1);
        assertLe(d.creatorResult, 100);
        assertGe(d.joinerResult, 1);
        assertLe(d.joinerResult, 100);
        _assertSolvent(ETH);
    }

    // ------------------------------------------------------------------
    // Suit (Gunting-Batu-Kertas)
    // ------------------------------------------------------------------

    function test_Suit_CreatorWins_RockBeatsScissors() public {
        bytes32 salt = keccak256("salt-1");
        uint256 id = _suitEth(alice, 1 ether, ROCK, salt);
        _joinEth(bob, id, 1 ether, SCISSORS);
        assertEq(uint8(_status(id)), uint8(DuelArena.Status.AwaitingReveal));

        vm.prank(alice);
        arena.revealSuit(id, ROCK, salt);

        assertEq(arena.getDuel(id).winner, alice);
        assertEq(arena.claimable(alice, ETH), 2 ether - _fee(1 ether));
        _assertSolvent(ETH);
    }

    function test_Suit_JoinerWins_PaperBeatsRock() public {
        bytes32 salt = keccak256("salt-2");
        uint256 id = _suitEth(alice, 1 ether, ROCK, salt);
        _joinEth(bob, id, 1 ether, PAPER);

        vm.prank(alice);
        arena.revealSuit(id, ROCK, salt);
        assertEq(arena.getDuel(id).winner, bob);
    }

    function test_Suit_ScissorsBeatPaper() public {
        bytes32 salt = keccak256("salt-3");
        uint256 id = _suitEth(alice, 1 ether, SCISSORS, salt);
        _joinEth(bob, id, 1 ether, PAPER);

        vm.prank(alice);
        arena.revealSuit(id, SCISSORS, salt);
        assertEq(arena.getDuel(id).winner, alice);
    }

    function test_Suit_DrawRefunds() public {
        bytes32 salt = keccak256("salt-4");
        uint256 id = _suitEth(alice, 1 ether, PAPER, salt);
        _joinEth(bob, id, 1 ether, PAPER);

        vm.prank(alice);
        arena.revealSuit(id, PAPER, salt);

        assertEq(uint8(_status(id)), uint8(DuelArena.Status.Draw));
        assertEq(arena.claimable(alice, ETH), 1 ether);
        assertEq(arena.claimable(bob, ETH), 1 ether);
        assertEq(arena.claimable(treasury, ETH), 0);
    }

    function test_Suit_RevertWrongSalt() public {
        uint256 id = _suitEth(alice, 1 ether, ROCK, keccak256("benar"));
        _joinEth(bob, id, 1 ether, PAPER);

        vm.prank(alice);
        vm.expectRevert(DuelArena.InvalidReveal.selector);
        arena.revealSuit(id, ROCK, keccak256("salah"));
    }

    function test_Suit_RevertChangedMove() public {
        bytes32 salt = keccak256("salt-5");
        uint256 id = _suitEth(alice, 1 ether, ROCK, salt);
        _joinEth(bob, id, 1 ether, PAPER);

        // Pembuat mencoba mengganti pilihan setelah melihat lawan.
        vm.prank(alice);
        vm.expectRevert(DuelArena.InvalidReveal.selector);
        arena.revealSuit(id, SCISSORS, salt);
    }

    function test_Suit_InvalidCommittedMoveLoses() public {
        bytes32 salt = keccak256("salt-6");
        uint256 id = _suitEth(alice, 1 ether, 4, salt); // pilihan tidak valid
        _joinEth(bob, id, 1 ether, ROCK);

        vm.prank(alice);
        arena.revealSuit(id, 4, salt);
        assertEq(arena.getDuel(id).winner, bob);
    }

    function test_Suit_RevealTimeoutJoinerWins() public {
        bytes32 salt = keccak256("salt-7");
        uint256 id = _suitEth(alice, 1 ether, ROCK, salt);
        _joinEth(bob, id, 1 ether, PAPER);

        vm.expectRevert(DuelArena.TooEarly.selector);
        arena.claimRevealTimeout(id);

        vm.warp(block.timestamp + arena.revealWindow() + 1);

        vm.prank(alice);
        vm.expectRevert(DuelArena.RevealWindowClosed.selector);
        arena.revealSuit(id, ROCK, salt);

        vm.prank(carol); // siapa pun boleh memicu
        arena.claimRevealTimeout(id);
        assertEq(arena.getDuel(id).winner, bob);
        assertEq(arena.claimable(bob, ETH), 2 ether - _fee(1 ether));
        assertEq(arena.claimable(carol, ETH), 0);
    }

    function test_Suit_OnlyCreatorCanReveal() public {
        bytes32 salt = keccak256("salt-8");
        uint256 id = _suitEth(alice, 1 ether, ROCK, salt);
        _joinEth(bob, id, 1 ether, PAPER);

        vm.prank(bob);
        vm.expectRevert(DuelArena.NotCreator.selector);
        arena.revealSuit(id, ROCK, salt);
    }

    function test_Suit_RevertInvalidJoinMove() public {
        uint256 id = _suitEth(alice, 1 ether, ROCK, keccak256("salt-9"));

        vm.prank(bob);
        vm.expectRevert(DuelArena.InvalidMove.selector);
        arena.join{value: 1 ether}(id, 0);

        vm.prank(bob);
        vm.expectRevert(DuelArena.InvalidMove.selector);
        arena.join{value: 1 ether}(id, 4);
    }

    function test_Suit_RevertReusedCommit() public {
        bytes32 salt = keccak256("salt-10");
        _suitEth(alice, 1 ether, ROCK, salt);

        bytes32 commit = arena.computeCommit(alice, ROCK, salt);
        vm.prank(alice);
        vm.expectRevert(DuelArena.CommitAlreadyUsed.selector);
        arena.createSuit{value: 1 ether}(ETH, 1 ether, commit);
    }

    function test_Suit_CommitBoundToCreator() public {
        // Bob menyalin commit Alice untuk membuat duelnya sendiri: hash tidak akan pernah cocok untuknya.
        bytes32 salt = keccak256("salt-11");
        bytes32 aliceCommit = arena.computeCommit(alice, ROCK, salt);
        assertTrue(aliceCommit != arena.computeCommit(bob, ROCK, salt));
    }

    // ------------------------------------------------------------------
    // Siklus duel: batal, kedaluwarsa, akses
    // ------------------------------------------------------------------

    function test_Cancel_RefundsCreator() public {
        uint256 id = _coinflipEth(alice, 1 ether, HEADS);

        vm.prank(bob);
        vm.expectRevert(DuelArena.NotCreator.selector);
        arena.cancel(id);

        vm.prank(alice);
        arena.cancel(id);
        assertEq(uint8(_status(id)), uint8(DuelArena.Status.Cancelled));
        assertEq(arena.claimable(alice, ETH), 1 ether);
        _assertSolvent(ETH);

        vm.prank(bob);
        vm.expectRevert(DuelArena.InvalidStatus.selector);
        arena.join{value: 1 ether}(id, 0);
    }

    function test_Cancel_RevertAfterJoined() public {
        uint256 id = _coinflipEth(alice, 1 ether, HEADS);
        _joinEth(bob, id, 1 ether, 0);

        vm.prank(alice);
        vm.expectRevert(DuelArena.InvalidStatus.selector);
        arena.cancel(id);
    }

    function test_Join_RevertExpired() public {
        uint256 id = _coinflipEth(alice, 1 ether, HEADS);
        vm.warp(block.timestamp + arena.openDuration() + 1);

        vm.prank(bob);
        vm.expectRevert(DuelArena.DuelExpired.selector);
        arena.join{value: 1 ether}(id, 0);

        // Pembuat tetap bisa menarik dananya.
        vm.prank(alice);
        arena.cancel(id);
        assertEq(arena.claimable(alice, ETH), 1 ether);
    }

    function test_Join_RevertOwnDuel() public {
        uint256 id = _coinflipEth(alice, 1 ether, HEADS);
        vm.prank(alice);
        vm.expectRevert(DuelArena.CannotJoinOwnDuel.selector);
        arena.join{value: 1 ether}(id, 0);
    }

    function test_Join_RevertWrongValue() public {
        uint256 id = _coinflipEth(alice, 1 ether, HEADS);
        vm.prank(bob);
        vm.expectRevert(DuelArena.WrongEthValue.selector);
        arena.join{value: 0.5 ether}(id, 0);
    }

    function test_Join_RevertSecondJoiner() public {
        uint256 id = _coinflipEth(alice, 1 ether, HEADS);
        _joinEth(bob, id, 1 ether, 0);

        vm.prank(carol);
        vm.expectRevert(DuelArena.InvalidStatus.selector);
        arena.join{value: 1 ether}(id, 0);
    }

    function test_Join_WorksAfterConfigTightened() public {
        uint256 id = _coinflipEth(alice, 5 ether, HEADS);
        vm.prank(owner);
        arena.setTokenConfig(ETH, true, 0.001 ether, 1 ether); // max diturunkan
        _joinEth(bob, id, 5 ether, 0); // duel lama tetap bisa diterima
        assertEq(uint8(_status(id)), uint8(DuelArena.Status.AwaitingRandomness));
    }

    // ------------------------------------------------------------------
    // Randomness
    // ------------------------------------------------------------------

    function test_Randomness_OnlyProvider() public {
        vm.prank(carol);
        vm.expectRevert(DuelArena.OnlyRandomnessProvider.selector);
        arena.fulfillRandomness(1, 1);
    }

    function test_Randomness_StuckRefund() public {
        uint256 id = _coinflipEth(alice, 1 ether, HEADS);
        _joinEth(bob, id, 1 ether, 0);
        uint256 reqId = arena.getDuel(id).requestId;

        vm.expectRevert(DuelArena.TooEarly.selector);
        arena.refundStuckRandomness(id);

        vm.warp(block.timestamp + arena.randomnessTimeout() + 1);
        vm.prank(carol);
        arena.refundStuckRandomness(id);

        assertEq(uint8(_status(id)), uint8(DuelArena.Status.Refunded));
        assertEq(arena.claimable(alice, ETH), 1 ether);
        assertEq(arena.claimable(bob, ETH), 1 ether);
        assertEq(arena.claimable(treasury, ETH), 0);

        // Randomness yang datang terlambat diabaikan tanpa revert.
        vrf.fulfill(reqId, 2);
        assertEq(uint8(_status(id)), uint8(DuelArena.Status.Refunded));
        assertEq(arena.claimable(alice, ETH), 1 ether);
        _assertSolvent(ETH);
    }

    function test_Randomness_LateButBeforeRefundStillSettles() public {
        uint256 id = _coinflipEth(alice, 1 ether, HEADS);
        _joinEth(bob, id, 1 ether, 0);
        vm.warp(block.timestamp + arena.randomnessTimeout() + 1);
        _fulfill(id, 0);
        assertEq(arena.getDuel(id).winner, alice);
    }

    function test_Randomness_DoubleFulfillIgnored() public {
        uint256 id = _coinflipEth(alice, 1 ether, HEADS);
        _joinEth(bob, id, 1 ether, 0);
        uint256 reqId = arena.getDuel(id).requestId;

        vrf.fulfill(reqId, 0); // alice menang
        vrf.fulfill(reqId, 1); // diabaikan
        assertEq(arena.getDuel(id).winner, alice);
        assertEq(arena.claimable(alice, ETH), 2 ether - _fee(1 ether));
    }

    // ------------------------------------------------------------------
    // Token & batas taruhan
    // ------------------------------------------------------------------

    function test_Create_RevertStakeOutOfRange() public {
        vm.prank(alice);
        vm.expectRevert(DuelArena.StakeOutOfRange.selector);
        arena.createCoinflip{value: 0.0001 ether}(ETH, 0.0001 ether, HEADS);

        vm.prank(alice);
        vm.expectRevert(DuelArena.StakeOutOfRange.selector);
        arena.createCoinflip(address(usdg), 20_000e6, HEADS);
    }

    function test_Create_RevertTokenNotAllowed() public {
        vm.prank(alice);
        vm.expectRevert(DuelArena.TokenNotAllowed.selector);
        arena.createCoinflip(address(0xBEEF), 1e6, HEADS);
    }

    function test_Create_RevertEthSentWithToken() public {
        vm.prank(alice);
        vm.expectRevert(DuelArena.WrongEthValue.selector);
        arena.createCoinflip{value: 1 ether}(address(usdg), 100e6, HEADS);
    }

    function test_Create_RevertFeeOnTransferToken() public {
        FeeOnTransferToken fot = new FeeOnTransferToken();
        vm.prank(owner);
        arena.setTokenConfig(address(fot), true, 1e18, 1000e18);
        fot.mint(alice, 100e18);
        vm.startPrank(alice);
        fot.approve(address(arena), type(uint256).max);
        vm.expectRevert(DuelArena.UnsupportedToken.selector);
        arena.createCoinflip(address(fot), 10e18, HEADS);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // Fee & admin
    // ------------------------------------------------------------------

    function test_Fee_LockedAtCreation() public {
        uint256 id = _coinflipEth(alice, 1 ether, HEADS);
        vm.prank(owner);
        arena.setFeeBps(1_000); // naik ke 10% setelah duel dibuat
        _joinEth(bob, id, 1 ether, 0);
        _fulfill(id, 0);
        assertEq(arena.claimable(treasury, ETH), _fee(1 ether)); // tetap 2,5%
    }

    function test_Fee_RevertAboveCap() public {
        vm.prank(owner);
        vm.expectRevert(DuelArena.FeeTooHigh.selector);
        arena.setFeeBps(1_001);
    }

    function test_Admin_OnlyOwner() public {
        vm.startPrank(carol);
        vm.expectRevert();
        arena.setFeeBps(100);
        vm.expectRevert();
        arena.setTreasury(carol);
        vm.expectRevert();
        arena.setRandomnessProvider(carol);
        vm.expectRevert();
        arena.pause();
        vm.expectRevert();
        arena.rescue(ETH, carol);
        vm.stopPrank();
    }

    function test_Pause_BlocksNewDuelsButNotExits() public {
        uint256 openId = _coinflipEth(alice, 1 ether, HEADS);
        uint256 liveId = _coinflipEth(alice, 1 ether, HEADS);
        _joinEth(bob, liveId, 1 ether, 0);

        vm.prank(owner);
        arena.pause();

        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        arena.createDice{value: 1 ether}(ETH, 1 ether);

        vm.prank(bob);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        arena.join{value: 1 ether}(openId, 0);

        // Jalan keluar tetap terbuka.
        vm.prank(alice);
        arena.cancel(openId);
        _fulfill(liveId, 0);
        vm.prank(alice);
        arena.withdraw(ETH);
        _assertSolvent(ETH);
    }

    function test_Rescue_OnlyExcess() public {
        vm.prank(alice);
        arena.createCoinflip(address(usdg), 500e6, HEADS); // 500 USDG terkunci

        usdg.mint(address(arena), 7e6); // terkirim tidak sengaja

        vm.prank(owner);
        arena.rescue(address(usdg), owner);
        assertEq(usdg.balanceOf(owner), 7e6);
        _assertSolvent(address(usdg));

        vm.prank(owner);
        vm.expectRevert(DuelArena.NothingToWithdraw.selector);
        arena.rescue(address(usdg), owner);
    }

    // ------------------------------------------------------------------
    // Keamanan
    // ------------------------------------------------------------------

    function test_Withdraw_RevertNothing() public {
        vm.prank(alice);
        vm.expectRevert(DuelArena.NothingToWithdraw.selector);
        arena.withdraw(ETH);
    }

    function test_Withdraw_ReentrancyBlocked() public {
        ReentrantPlayer attacker = new ReentrantPlayer(arena);
        vm.deal(address(attacker), 0);
        attacker.createAndCancel{value: 1 ether}(1 ether);
        assertEq(arena.claimable(address(attacker), ETH), 1 ether);

        vm.expectRevert(DuelArena.EthTransferFailed.selector);
        attacker.attack();

        // Tidak ada dana yang keluar; saldo tetap tercatat.
        assertEq(arena.claimable(address(attacker), ETH), 1 ether);
        assertEq(address(arena).balance, 1 ether);
        _assertSolvent(ETH);
    }

    // ------------------------------------------------------------------
    // Fuzz: konservasi dana
    // ------------------------------------------------------------------

    function testFuzz_Coinflip_FundsConserved(uint256 amount, uint256 word, uint8 side) public {
        amount = bound(amount, 1e6, 10_000e6);
        side = uint8(bound(side, 0, 1));

        vm.prank(alice);
        uint256 id = arena.createCoinflip(address(usdg), amount, side);
        _join(bob, id, 0);
        _fulfill(id, word);

        address token = address(usdg);
        uint256 total = arena.claimable(alice, token) + arena.claimable(bob, token) + arena.claimable(treasury, token);
        assertEq(total, amount * 2, "dana hilang/bertambah");
        assertEq(arena.escrowed(token), 0);
        _assertSolvent(token);

        address winner = arena.getDuel(id).winner;
        assertTrue(winner == alice || winner == bob);
        assertEq(winner == alice, (word % 2) == side);
    }

    function testFuzz_Suit_AllOutcomes(uint8 creatorMove, uint8 joinerMove) public {
        creatorMove = uint8(bound(creatorMove, 1, 3));
        joinerMove = uint8(bound(joinerMove, 1, 3));
        bytes32 salt = keccak256(abi.encode(creatorMove, joinerMove));

        uint256 id = _suitEth(alice, 1 ether, creatorMove, salt);
        _joinEth(bob, id, 1 ether, joinerMove);
        vm.prank(alice);
        arena.revealSuit(id, creatorMove, salt);

        DuelArena.Duel memory d = arena.getDuel(id);
        if (creatorMove == joinerMove) {
            assertEq(uint8(d.status), uint8(DuelArena.Status.Draw));
        } else {
            // Tabel kemenangan eksplisit, independen dari rumus di kontrak.
            bool aliceWins = (creatorMove == ROCK && joinerMove == SCISSORS)
                || (creatorMove == PAPER && joinerMove == ROCK) || (creatorMove == SCISSORS && joinerMove == PAPER);
            assertEq(d.winner, aliceWins ? alice : bob);
        }
        _assertSolvent(ETH);
    }
}
