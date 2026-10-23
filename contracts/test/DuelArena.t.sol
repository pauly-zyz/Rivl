// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {DuelArena} from "../src/DuelArena.sol";
import {MockUSDG, FeeOnTransferToken, ReentrantPlayer} from "./mocks/Mocks.sol";

contract DuelArenaTest is Test {
    // Konstanta lokal (jangan panggil arena.HEADS() di dalam vm.prank — itu menghabiskan prank).
    uint8 constant HEADS = 0;
    uint8 constant TAILS = 1;
    uint8 constant ROCK = 1;
    uint8 constant PAPER = 2;
    uint8 constant SCISSORS = 3;
    uint8 constant NO_MOVE = 0;
    uint16 constant FEE_BPS = 250;
    address constant ETH = address(0);
    bytes32 constant SEED = keccak256("bob-seed");

    DuelArena arena;
    MockUSDG usdg;

    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    function setUp() public {
        usdg = new MockUSDG();
        arena = new DuelArena(owner, treasury, FEE_BPS);

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

    function _word(bytes32 salt, bytes32 seed) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(salt, seed)));
    }

    function _rolls(uint256 word) internal pure returns (uint8 creatorRoll, uint8 joinerRoll) {
        creatorRoll = uint8(uint128(word) % 100) + 1;
        joinerRoll = uint8((word >> 128) % 100) + 1;
    }

    /// @dev Salt pertama (dari `start`) yang membuat lemparan koin = `result` untuk seed tertentu.
    function _saltForCoin(bytes32 seed, uint8 result, uint256 start) internal pure returns (bytes32 salt) {
        for (uint256 i = start;; i++) {
            salt = keccak256(abi.encode("coin", i));
            if (_word(salt, seed) % 2 == result) return salt;
        }
    }

    /// @dev Salt pertama yang membuat Dice berakhir seri (0) / pembuat menang (1) / penerima menang (2).
    function _saltForDice(bytes32 seed, uint8 outcome) internal pure returns (bytes32 salt) {
        for (uint256 i;; i++) {
            salt = keccak256(abi.encode("dice", i));
            (uint8 c, uint8 j) = _rolls(_word(salt, seed));
            if ((outcome == 0 && c == j) || (outcome == 1 && c > j) || (outcome == 2 && c < j)) return salt;
        }
    }

    function _coinflipEth(address who, uint256 amount, uint8 side, bytes32 salt) internal returns (uint256 id) {
        bytes32 commit = arena.computeCommit(who, NO_MOVE, salt);
        vm.prank(who);
        id = arena.createCoinflip{value: amount}(ETH, amount, side, commit);
    }

    function _diceEth(address who, uint256 amount, bytes32 salt) internal returns (uint256 id) {
        bytes32 commit = arena.computeCommit(who, NO_MOVE, salt);
        vm.prank(who);
        id = arena.createDice{value: amount}(ETH, amount, commit);
    }

    function _suitEth(address who, uint256 amount, uint8 move, bytes32 salt) internal returns (uint256 id) {
        bytes32 commit = arena.computeCommit(who, move, salt);
        vm.prank(who);
        id = arena.createSuit{value: amount}(ETH, amount, commit);
    }

    function _joinEth(address who, uint256 id, uint256 amount, uint8 move, bytes32 seed) internal {
        vm.prank(who);
        arena.join{value: amount}(id, move, seed);
    }

    function _reveal(address who, uint256 id, uint8 move, bytes32 salt) internal {
        vm.prank(who);
        arena.reveal(id, move, salt);
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
        bytes32 salt = _saltForCoin(SEED, HEADS, 0);
        uint256 id = _coinflipEth(alice, 1 ether, HEADS, salt);
        _joinEth(bob, id, 1 ether, 0, SEED);
        assertEq(uint8(_status(id)), uint8(DuelArena.Status.AwaitingReveal));
        assertEq(arena.getDuel(id).joinerSeed, SEED);

        _reveal(alice, id, NO_MOVE, salt);

        DuelArena.Duel memory d = arena.getDuel(id);
        assertEq(uint8(d.status), uint8(DuelArena.Status.Settled));
        assertEq(d.winner, alice);
        assertEq(d.creatorResult, HEADS);
        assertEq(d.salt, salt);
        assertEq(d.randomWord, _word(salt, SEED));

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
        bytes32 salt = _saltForCoin(SEED, TAILS, 0);
        bytes32 commit = arena.computeCommit(alice, NO_MOVE, salt);
        vm.prank(alice);
        uint256 id = arena.createCoinflip(address(usdg), 100e6, HEADS, commit);
        vm.prank(bob);
        arena.join(id, 0, SEED);
        _reveal(alice, id, NO_MOVE, salt);

        assertEq(arena.getDuel(id).winner, bob);
        assertEq(arena.getDuel(id).creatorResult, TAILS);
        assertEq(arena.claimable(bob, address(usdg)), 200e6 - _fee(100e6)); // 195 USDG
        assertEq(arena.claimable(treasury, address(usdg)), 5e6);
        _assertSolvent(address(usdg));

        uint256 before = usdg.balanceOf(treasury);
        vm.prank(treasury);
        arena.withdraw(address(usdg));
        assertEq(usdg.balanceOf(treasury), before + 5e6);
    }

    function test_Coinflip_RevertInvalidSide() public {
        bytes32 commit = arena.computeCommit(alice, NO_MOVE, keccak256("s"));
        vm.prank(alice);
        vm.expectRevert(DuelArena.InvalidSide.selector);
        arena.createCoinflip{value: 1 ether}(ETH, 1 ether, 2, commit);
    }

    function test_Coinflip_RevertZeroCommit() public {
        vm.prank(alice);
        vm.expectRevert(DuelArena.InvalidCommit.selector);
        arena.createCoinflip{value: 1 ether}(ETH, 1 ether, HEADS, bytes32(0));
    }

    function test_Coinflip_RevertZeroSeed() public {
        uint256 id = _coinflipEth(alice, 1 ether, HEADS, keccak256("s"));
        vm.prank(bob);
        vm.expectRevert(DuelArena.InvalidSeed.selector);
        arena.join{value: 1 ether}(id, 0, bytes32(0));
    }

    function test_Coinflip_RevertMoveOnJoin() public {
        uint256 id = _coinflipEth(alice, 1 ether, HEADS, keccak256("s"));
        vm.prank(bob);
        vm.expectRevert(DuelArena.InvalidMove.selector);
        arena.join{value: 1 ether}(id, ROCK, SEED);
    }

    function test_Coinflip_RevealTimeoutJoinerWins() public {
        // Pembuat tahu dia kalah setelah melihat seed, lalu tidak reveal: penerima tetap menang.
        bytes32 salt = _saltForCoin(SEED, TAILS, 0);
        uint256 id = _coinflipEth(alice, 1 ether, HEADS, salt);
        _joinEth(bob, id, 1 ether, 0, SEED);

        vm.expectRevert(DuelArena.TooEarly.selector);
        arena.claimRevealTimeout(id);

        vm.warp(block.timestamp + arena.revealWindow() + 1);
        vm.prank(alice);
        vm.expectRevert(DuelArena.RevealWindowClosed.selector);
        arena.reveal(id, NO_MOVE, salt);

        vm.prank(carol);
        arena.claimRevealTimeout(id);
        assertEq(arena.getDuel(id).winner, bob);
        assertEq(arena.claimable(bob, ETH), 2 ether - _fee(1 ether));
        _assertSolvent(ETH);
    }

    function test_Coinflip_RevertWrongSalt() public {
        uint256 id = _coinflipEth(alice, 1 ether, HEADS, keccak256("benar"));
        _joinEth(bob, id, 1 ether, 0, SEED);
        vm.prank(alice);
        vm.expectRevert(DuelArena.InvalidReveal.selector);
        arena.reveal(id, NO_MOVE, keccak256("salah"));
    }

    function test_Coinflip_NonZeroCommittedMoveLoses() public {
        // Commit dibuat dengan move ≠ 0: hash cocok, tapi nilainya tidak valid untuk Coinflip → pembuat kalah.
        bytes32 salt = keccak256("s");
        bytes32 commit = arena.computeCommit(alice, 7, salt);
        vm.prank(alice);
        uint256 id = arena.createCoinflip{value: 1 ether}(ETH, 1 ether, HEADS, commit);
        _joinEth(bob, id, 1 ether, 0, SEED);
        _reveal(alice, id, 7, salt);
        assertEq(arena.getDuel(id).winner, bob);
        _assertSolvent(ETH);
    }

    function test_Coinflip_OnlyCreatorCanReveal() public {
        bytes32 salt = keccak256("s");
        uint256 id = _coinflipEth(alice, 1 ether, HEADS, salt);
        _joinEth(bob, id, 1 ether, 0, SEED);
        vm.prank(bob);
        vm.expectRevert(DuelArena.NotCreator.selector);
        arena.reveal(id, NO_MOVE, salt);
    }

    function test_Coinflip_SeedChangesOutcome() public pure {
        // Hasil bergantung pada seed penerima, jadi pembuat tidak bisa menentukan hasil sendirian.
        bytes32 salt = keccak256("tetap");
        bool sawHeads;
        bool sawTails;
        for (uint256 i; i < 16; i++) {
            uint256 w = uint256(keccak256(abi.encode(salt, keccak256(abi.encode(i)))));
            if (w % 2 == 0) sawHeads = true;
            else sawTails = true;
        }
        assertTrue(sawHeads && sawTails);
    }

    // ------------------------------------------------------------------
    // Dice
    // ------------------------------------------------------------------

    function test_Dice_HigherRollWins() public {
        bytes32 salt = _saltForDice(SEED, 2);
        uint256 id = _diceEth(alice, 1 ether, salt);
        _joinEth(bob, id, 1 ether, 0, SEED);
        _reveal(alice, id, NO_MOVE, salt);

        (uint8 c, uint8 j) = _rolls(_word(salt, SEED));
        DuelArena.Duel memory d = arena.getDuel(id);
        assertEq(d.creatorResult, c);
        assertEq(d.joinerResult, j);
        assertLt(c, j);
        assertEq(d.winner, bob);
        assertEq(arena.claimable(bob, ETH), 2 ether - _fee(1 ether));
        _assertSolvent(ETH);
    }

    function test_Dice_CreatorHigherWins() public {
        bytes32 salt = _saltForDice(SEED, 1);
        uint256 id = _diceEth(alice, 1 ether, salt);
        _joinEth(bob, id, 1 ether, 0, SEED);
        _reveal(alice, id, NO_MOVE, salt);
        assertEq(arena.getDuel(id).winner, alice);
        _assertSolvent(ETH);
    }

    function test_Dice_TieRefundsWithoutFee() public {
        bytes32 salt = _saltForDice(SEED, 0);
        uint256 id = _diceEth(alice, 1 ether, salt);
        _joinEth(bob, id, 1 ether, 0, SEED);
        _reveal(alice, id, NO_MOVE, salt);

        DuelArena.Duel memory d = arena.getDuel(id);
        assertEq(uint8(d.status), uint8(DuelArena.Status.Draw));
        assertEq(d.creatorResult, d.joinerResult);
        assertEq(arena.claimable(alice, ETH), 1 ether);
        assertEq(arena.claimable(bob, ETH), 1 ether);
        assertEq(arena.claimable(treasury, ETH), 0);
        _assertSolvent(ETH);
    }

    function testFuzz_Dice_RollsInRange(bytes32 salt, bytes32 seed) public {
        vm.assume(seed != bytes32(0));
        uint256 id = _diceEth(alice, 1 ether, salt);
        _joinEth(bob, id, 1 ether, 0, seed);
        _reveal(alice, id, NO_MOVE, salt);

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
        _joinEth(bob, id, 1 ether, SCISSORS, 0);
        assertEq(uint8(_status(id)), uint8(DuelArena.Status.AwaitingReveal));

        _reveal(alice, id, ROCK, salt);

        assertEq(arena.getDuel(id).winner, alice);
        assertEq(arena.getDuel(id).randomWord, 0);
        assertEq(arena.claimable(alice, ETH), 2 ether - _fee(1 ether));
        _assertSolvent(ETH);
    }

    function test_Suit_JoinerWins_PaperBeatsRock() public {
        bytes32 salt = keccak256("salt-2");
        uint256 id = _suitEth(alice, 1 ether, ROCK, salt);
        _joinEth(bob, id, 1 ether, PAPER, 0);
        _reveal(alice, id, ROCK, salt);
        assertEq(arena.getDuel(id).winner, bob);
    }

    function test_Suit_ScissorsBeatPaper() public {
        bytes32 salt = keccak256("salt-3");
        uint256 id = _suitEth(alice, 1 ether, SCISSORS, salt);
        _joinEth(bob, id, 1 ether, PAPER, 0);
        _reveal(alice, id, SCISSORS, salt);
        assertEq(arena.getDuel(id).winner, alice);
    }

    function test_Suit_SeedIgnored() public {
        bytes32 salt = keccak256("salt-3b");
        uint256 id = _suitEth(alice, 1 ether, SCISSORS, salt);
        _joinEth(bob, id, 1 ether, PAPER, SEED);
        assertEq(arena.getDuel(id).joinerSeed, bytes32(0));
    }

    function test_Suit_DrawRefunds() public {
        bytes32 salt = keccak256("salt-4");
        uint256 id = _suitEth(alice, 1 ether, PAPER, salt);
        _joinEth(bob, id, 1 ether, PAPER, 0);
        _reveal(alice, id, PAPER, salt);

        assertEq(uint8(_status(id)), uint8(DuelArena.Status.Draw));
        assertEq(arena.claimable(alice, ETH), 1 ether);
        assertEq(arena.claimable(bob, ETH), 1 ether);
        assertEq(arena.claimable(treasury, ETH), 0);
    }

    function test_Suit_RevertWrongSalt() public {
        uint256 id = _suitEth(alice, 1 ether, ROCK, keccak256("benar"));
        _joinEth(bob, id, 1 ether, PAPER, 0);

        vm.prank(alice);
        vm.expectRevert(DuelArena.InvalidReveal.selector);
        arena.reveal(id, ROCK, keccak256("salah"));
    }

    function test_Suit_RevertChangedMove() public {
        bytes32 salt = keccak256("salt-5");
        uint256 id = _suitEth(alice, 1 ether, ROCK, salt);
        _joinEth(bob, id, 1 ether, PAPER, 0);

        // Pembuat mencoba mengganti pilihan setelah melihat lawan.
        vm.prank(alice);
        vm.expectRevert(DuelArena.InvalidReveal.selector);
        arena.reveal(id, SCISSORS, salt);
    }

    function test_Suit_InvalidCommittedMoveLoses() public {
        bytes32 salt = keccak256("salt-6");
        uint256 id = _suitEth(alice, 1 ether, 4, salt); // pilihan tidak valid
        _joinEth(bob, id, 1 ether, ROCK, 0);
        _reveal(alice, id, 4, salt);
        assertEq(arena.getDuel(id).winner, bob);
    }

    function test_Suit_RevealTimeoutJoinerWins() public {
        bytes32 salt = keccak256("salt-7");
        uint256 id = _suitEth(alice, 1 ether, ROCK, salt);
        _joinEth(bob, id, 1 ether, PAPER, 0);

        vm.expectRevert(DuelArena.TooEarly.selector);
        arena.claimRevealTimeout(id);

        vm.warp(block.timestamp + arena.revealWindow() + 1);

        vm.prank(alice);
        vm.expectRevert(DuelArena.RevealWindowClosed.selector);
        arena.reveal(id, ROCK, salt);

        vm.prank(carol); // siapa pun boleh memicu
        arena.claimRevealTimeout(id);
        assertEq(arena.getDuel(id).winner, bob);
        assertEq(arena.claimable(bob, ETH), 2 ether - _fee(1 ether));
        assertEq(arena.claimable(carol, ETH), 0);
    }

    function test_Suit_OnlyCreatorCanReveal() public {
        bytes32 salt = keccak256("salt-8");
        uint256 id = _suitEth(alice, 1 ether, ROCK, salt);
        _joinEth(bob, id, 1 ether, PAPER, 0);

        vm.prank(bob);
        vm.expectRevert(DuelArena.NotCreator.selector);
        arena.reveal(id, ROCK, salt);
    }

    function test_Suit_RevertInvalidJoinMove() public {
        uint256 id = _suitEth(alice, 1 ether, ROCK, keccak256("salt-9"));

        vm.prank(bob);
        vm.expectRevert(DuelArena.InvalidMove.selector);
        arena.join{value: 1 ether}(id, 0, 0);

        vm.prank(bob);
        vm.expectRevert(DuelArena.InvalidMove.selector);
        arena.join{value: 1 ether}(id, 4, 0);
    }

    function test_Commit_RevertReusedAcrossGames() public {
        bytes32 salt = keccak256("salt-10");
        _coinflipEth(alice, 1 ether, HEADS, salt);

        bytes32 commit = arena.computeCommit(alice, NO_MOVE, salt);
        vm.prank(alice);
        vm.expectRevert(DuelArena.CommitAlreadyUsed.selector);
        arena.createDice{value: 1 ether}(ETH, 1 ether, commit);

        vm.prank(alice);
        vm.expectRevert(DuelArena.CommitAlreadyUsed.selector);
        arena.createSuit{value: 1 ether}(ETH, 1 ether, commit);
    }

    function test_Suit_CommitBoundToCreator() public view {
        // Bob menyalin commit Alice untuk membuat duelnya sendiri: hash tidak akan pernah cocok untuknya.
        bytes32 salt = keccak256("salt-11");
        bytes32 aliceCommit = arena.computeCommit(alice, ROCK, salt);
        assertTrue(aliceCommit != arena.computeCommit(bob, ROCK, salt));
    }

    // ------------------------------------------------------------------
    // Siklus duel: batal, kedaluwarsa, akses
    // ------------------------------------------------------------------

    function test_Cancel_RefundsCreator() public {
        uint256 id = _coinflipEth(alice, 1 ether, HEADS, keccak256("s"));

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
        arena.join{value: 1 ether}(id, 0, SEED);
    }

    function test_Cancel_RevertAfterJoined() public {
        uint256 id = _coinflipEth(alice, 1 ether, HEADS, keccak256("s"));
        _joinEth(bob, id, 1 ether, 0, SEED);

        vm.prank(alice);
        vm.expectRevert(DuelArena.InvalidStatus.selector);
        arena.cancel(id);
    }

    function test_Join_RevertExpired() public {
        uint256 id = _coinflipEth(alice, 1 ether, HEADS, keccak256("s"));
        vm.warp(block.timestamp + arena.openDuration() + 1);

        vm.prank(bob);
        vm.expectRevert(DuelArena.DuelExpired.selector);
        arena.join{value: 1 ether}(id, 0, SEED);

        // Pembuat tetap bisa menarik dananya.
        vm.prank(alice);
        arena.cancel(id);
        assertEq(arena.claimable(alice, ETH), 1 ether);
    }

    function test_Join_RevertOwnDuel() public {
        uint256 id = _coinflipEth(alice, 1 ether, HEADS, keccak256("s"));
        vm.prank(alice);
        vm.expectRevert(DuelArena.CannotJoinOwnDuel.selector);
        arena.join{value: 1 ether}(id, 0, SEED);
    }

    function test_Join_RevertWrongValue() public {
        uint256 id = _coinflipEth(alice, 1 ether, HEADS, keccak256("s"));
        vm.prank(bob);
        vm.expectRevert(DuelArena.WrongEthValue.selector);
        arena.join{value: 0.5 ether}(id, 0, SEED);
    }

    function test_Join_RevertSecondJoiner() public {
        uint256 id = _coinflipEth(alice, 1 ether, HEADS, keccak256("s"));
        _joinEth(bob, id, 1 ether, 0, SEED);

        vm.prank(carol);
        vm.expectRevert(DuelArena.InvalidStatus.selector);
        arena.join{value: 1 ether}(id, 0, SEED);
    }

    function test_Join_WorksAfterConfigTightened() public {
        uint256 id = _coinflipEth(alice, 5 ether, HEADS, keccak256("s"));
        vm.prank(owner);
        arena.setTokenConfig(ETH, true, 0.001 ether, 1 ether); // max diturunkan
        _joinEth(bob, id, 5 ether, 0, SEED); // duel lama tetap bisa diterima
        assertEq(uint8(_status(id)), uint8(DuelArena.Status.AwaitingReveal));
    }

    function test_Reveal_RevertTwice() public {
        bytes32 salt = keccak256("s");
        uint256 id = _coinflipEth(alice, 1 ether, HEADS, salt);
        _joinEth(bob, id, 1 ether, 0, SEED);
        _reveal(alice, id, NO_MOVE, salt);

        vm.prank(alice);
        vm.expectRevert(DuelArena.InvalidStatus.selector);
        arena.reveal(id, NO_MOVE, salt);
        vm.expectRevert(DuelArena.InvalidStatus.selector);
        arena.claimRevealTimeout(id);
    }

    function test_Reveal_RevertBeforeJoin() public {
        bytes32 salt = keccak256("s");
        uint256 id = _coinflipEth(alice, 1 ether, HEADS, salt);
        vm.prank(alice);
        vm.expectRevert(DuelArena.InvalidStatus.selector);
        arena.reveal(id, NO_MOVE, salt);
    }

    // ------------------------------------------------------------------
    // Token & batas taruhan
    // ------------------------------------------------------------------

    function test_Create_RevertStakeOutOfRange() public {
        bytes32 c1 = arena.computeCommit(alice, NO_MOVE, keccak256("a"));
        bytes32 c2 = arena.computeCommit(alice, NO_MOVE, keccak256("b"));
        vm.prank(alice);
        vm.expectRevert(DuelArena.StakeOutOfRange.selector);
        arena.createCoinflip{value: 0.0001 ether}(ETH, 0.0001 ether, HEADS, c1);

        vm.prank(alice);
        vm.expectRevert(DuelArena.StakeOutOfRange.selector);
        arena.createCoinflip(address(usdg), 20_000e6, HEADS, c2);
    }

    function test_Create_RevertTokenNotAllowed() public {
        bytes32 c = arena.computeCommit(alice, NO_MOVE, keccak256("a"));
        vm.prank(alice);
        vm.expectRevert(DuelArena.TokenNotAllowed.selector);
        arena.createCoinflip(address(0xBEEF), 1e6, HEADS, c);
    }

    function test_Create_RevertEthSentWithToken() public {
        bytes32 c = arena.computeCommit(alice, NO_MOVE, keccak256("a"));
        vm.prank(alice);
        vm.expectRevert(DuelArena.WrongEthValue.selector);
        arena.createCoinflip{value: 1 ether}(address(usdg), 100e6, HEADS, c);
    }

    function test_Create_RevertFeeOnTransferToken() public {
        FeeOnTransferToken fot = new FeeOnTransferToken();
        vm.prank(owner);
        arena.setTokenConfig(address(fot), true, 1e18, 1000e18);
        fot.mint(alice, 100e18);
        bytes32 c = arena.computeCommit(alice, NO_MOVE, keccak256("a"));
        vm.startPrank(alice);
        fot.approve(address(arena), type(uint256).max);
        vm.expectRevert(DuelArena.UnsupportedToken.selector);
        arena.createCoinflip(address(fot), 10e18, HEADS, c);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // Fee & admin
    // ------------------------------------------------------------------

    function test_Fee_LockedAtCreation() public {
        bytes32 salt = keccak256("s");
        uint256 id = _coinflipEth(alice, 1 ether, HEADS, salt);
        vm.prank(owner);
        arena.setFeeBps(1_000); // naik ke 10% setelah duel dibuat
        _joinEth(bob, id, 1 ether, 0, SEED);
        _reveal(alice, id, NO_MOVE, salt);
        assertEq(arena.claimable(treasury, ETH), _fee(1 ether)); // tetap 2,5%
    }

    function test_Fee_RevertAboveCap() public {
        vm.prank(owner);
        vm.expectRevert(DuelArena.FeeTooHigh.selector);
        arena.setFeeBps(1_001);

        vm.expectRevert(DuelArena.FeeTooHigh.selector);
        new DuelArena(owner, treasury, 1_001);
    }

    function test_Constructor_RevertZeroTreasury() public {
        vm.expectRevert(DuelArena.ZeroAddress.selector);
        new DuelArena(owner, address(0), FEE_BPS);
    }

    function test_Timings() public {
        vm.prank(owner);
        arena.setTimings(2 hours, 30 minutes);
        assertEq(arena.openDuration(), 2 hours);
        assertEq(arena.revealWindow(), 30 minutes);

        vm.startPrank(owner);
        vm.expectRevert(DuelArena.InvalidConfig.selector);
        arena.setTimings(1 minutes, 30 minutes);
        vm.expectRevert(DuelArena.InvalidConfig.selector);
        arena.setTimings(2 hours, 2 days);
        vm.stopPrank();
    }

    function test_Admin_OnlyOwner() public {
        vm.startPrank(carol);
        vm.expectRevert();
        arena.setFeeBps(100);
        vm.expectRevert();
        arena.setTreasury(carol);
        vm.expectRevert();
        arena.setTimings(2 hours, 30 minutes);
        vm.expectRevert();
        arena.setTokenConfig(ETH, false, 0, 0);
        vm.expectRevert();
        arena.pause();
        vm.expectRevert();
        arena.rescue(ETH, carol);
        vm.stopPrank();
    }

    function test_Pause_BlocksNewDuelsButNotExits() public {
        bytes32 salt = keccak256("live");
        uint256 openId = _coinflipEth(alice, 1 ether, HEADS, keccak256("open"));
        uint256 liveId = _coinflipEth(alice, 1 ether, HEADS, salt);
        uint256 lateId = _coinflipEth(alice, 1 ether, HEADS, keccak256("late"));
        _joinEth(bob, liveId, 1 ether, 0, SEED);
        _joinEth(bob, lateId, 1 ether, 0, SEED);

        vm.prank(owner);
        arena.pause();

        bytes32 c = arena.computeCommit(alice, NO_MOVE, keccak256("new"));
        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        arena.createDice{value: 1 ether}(ETH, 1 ether, c);

        vm.prank(bob);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        arena.join{value: 1 ether}(openId, 0, SEED);

        // Jalan keluar tetap terbuka: batal, reveal, timeout, withdraw.
        vm.prank(alice);
        arena.cancel(openId);
        _reveal(alice, liveId, NO_MOVE, salt);
        vm.warp(block.timestamp + arena.revealWindow() + 1);
        arena.claimRevealTimeout(lateId);
        vm.prank(alice);
        arena.withdraw(ETH);
        _assertSolvent(ETH);
    }

    function test_Rescue_OnlyExcess() public {
        bytes32 c = arena.computeCommit(alice, NO_MOVE, keccak256("a"));
        vm.prank(alice);
        arena.createCoinflip(address(usdg), 500e6, HEADS, c); // 500 USDG terkunci

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

    function testFuzz_Coinflip_FundsConserved(uint256 amount, bytes32 salt, bytes32 seed, uint8 side) public {
        amount = bound(amount, 1e6, 10_000e6);
        side = uint8(bound(side, 0, 1));
        vm.assume(seed != bytes32(0));

        bytes32 commit = arena.computeCommit(alice, NO_MOVE, salt);
        vm.prank(alice);
        uint256 id = arena.createCoinflip(address(usdg), amount, side, commit);
        vm.prank(bob);
        arena.join(id, 0, seed);
        _reveal(alice, id, NO_MOVE, salt);

        address token = address(usdg);
        uint256 total = arena.claimable(alice, token) + arena.claimable(bob, token) + arena.claimable(treasury, token);
        assertEq(total, amount * 2, "dana hilang/bertambah");
        assertEq(arena.escrowed(token), 0);
        _assertSolvent(token);

        address winner = arena.getDuel(id).winner;
        assertTrue(winner == alice || winner == bob);
        assertEq(winner == alice, (_word(salt, seed) % 2) == side);
    }

    function testFuzz_Suit_AllOutcomes(uint8 creatorMove, uint8 joinerMove) public {
        creatorMove = uint8(bound(creatorMove, 1, 3));
        joinerMove = uint8(bound(joinerMove, 1, 3));
        bytes32 salt = keccak256(abi.encode(creatorMove, joinerMove));

        uint256 id = _suitEth(alice, 1 ether, creatorMove, salt);
        _joinEth(bob, id, 1 ether, joinerMove, 0);
        _reveal(alice, id, creatorMove, salt);

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
