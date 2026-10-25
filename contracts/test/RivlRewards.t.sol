// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {RivlRewards} from "../src/RivlRewards.sol";
import {MockRivl, MockUSDG} from "./mocks/Mocks.sol";

contract RivlRewardsTest is Test {
    RivlRewards rewards;
    MockRivl rivl;
    MockUSDG usdg;

    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address constant ETH = address(0);

    function setUp() public {
        rewards = new RivlRewards(owner);
        rivl = new MockRivl();
        usdg = new MockUSDG();
        rivl.mint(address(rewards), 1_000_000e18);
        usdg.mint(address(rewards), 1_000e6);
        vm.deal(address(this), 10 ether);
        (bool ok,) = address(rewards).call{value: 5 ether}("");
        assertTrue(ok);
    }

    // --- Merkle helper (pasangan diurutkan, sama dengan OpenZeppelin MerkleProof dan web/indexer) ---

    function leaf(address account, address token, uint256 amount) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(account, token, amount))));
    }

    function hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    /// Pohon 4 daun: [l0,l1,l2,l3] → root, dan bukti untuk tiap daun.
    function tree4(bytes32[4] memory l) internal pure returns (bytes32 root, bytes32[][4] memory proofs) {
        bytes32 n01 = hashPair(l[0], l[1]);
        bytes32 n23 = hashPair(l[2], l[3]);
        root = hashPair(n01, n23);
        for (uint256 i; i < 4; ++i) {
            proofs[i] = new bytes32[](2);
            proofs[i][0] = l[i ^ 1];
            proofs[i][1] = i < 2 ? n23 : n01;
        }
    }

    function one(address token, uint256 amount, bytes32[] memory proof)
        internal
        pure
        returns (RivlRewards.Claim[] memory c)
    {
        c = new RivlRewards.Claim[](1);
        c[0] = RivlRewards.Claim(token, amount, proof);
    }

    // --- Test ---

    function test_ClaimAllTokensInOneTx_ThenCumulativeTopUp() public {
        bytes32[4] memory l =
            [leaf(alice, address(rivl), 60_000e18), leaf(alice, ETH, 0.01 ether), leaf(alice, address(usdg), 2e6), leaf(bob, address(rivl), 10_000e18)];
        (bytes32 root, bytes32[][4] memory p) = tree4(l);
        vm.prank(owner);
        rewards.setRoot(root, 1);

        RivlRewards.Claim[] memory c = new RivlRewards.Claim[](3);
        c[0] = RivlRewards.Claim(address(rivl), 60_000e18, p[0]);
        c[1] = RivlRewards.Claim(ETH, 0.01 ether, p[1]);
        c[2] = RivlRewards.Claim(address(usdg), 2e6, p[2]);
        vm.prank(bob); // siapa pun boleh mengirim; hadiah tetap ke alice
        rewards.claim(alice, c);
        assertEq(rivl.balanceOf(alice), 60_000e18);
        assertEq(alice.balance, 0.01 ether);
        assertEq(usdg.balanceOf(alice), 2e6);

        // Klaim ulang dengan root yang sama: tidak ada lagi.
        vm.expectRevert(RivlRewards.NothingToClaim.selector);
        rewards.claim(alice, c);

        // Minggu berikutnya: kumulatif naik 60k → 110k, yang dibayar hanya selisihnya.
        bytes32[4] memory l2 =
            [leaf(alice, address(rivl), 110_000e18), leaf(alice, ETH, 0.01 ether), leaf(alice, address(usdg), 2e6), leaf(bob, address(rivl), 10_000e18)];
        (bytes32 root2, bytes32[][4] memory p2) = tree4(l2);
        vm.prank(owner);
        rewards.setRoot(root2, 2);
        assertEq(rewards.claimableAmount(alice, address(rivl), 110_000e18, p2[0]), 50_000e18);
        rewards.claim(alice, one(address(rivl), 110_000e18, p2[0]));
        assertEq(rivl.balanceOf(alice), 110_000e18);

        // Bob belum pernah klaim: jumlahnya tetap utuh di root baru.
        rewards.claim(bob, one(address(rivl), 10_000e18, p2[3]));
        assertEq(rivl.balanceOf(bob), 10_000e18);
    }

    function test_RejectsWrongAmountOrAccount() public {
        bytes32[4] memory l = [leaf(alice, address(rivl), 1e18), leaf(bob, address(rivl), 2e18), bytes32(uint256(1)), bytes32(uint256(2))];
        (bytes32 root, bytes32[][4] memory p) = tree4(l);
        vm.prank(owner);
        rewards.setRoot(root, 1);

        vm.expectRevert(RivlRewards.InvalidProof.selector);
        rewards.claim(alice, one(address(rivl), 2e18, p[0])); // jumlah dinaikkan
        vm.expectRevert(RivlRewards.InvalidProof.selector);
        rewards.claim(bob, one(address(rivl), 1e18, p[0])); // bukti milik alice
        assertEq(rewards.claimableAmount(alice, address(rivl), 2e18, p[0]), 0);
    }

    function test_UnderfundedClaimRevertsAndCanRetryLater() public {
        bytes32[4] memory l = [leaf(alice, address(rivl), 2_000_000e18), bytes32(uint256(1)), bytes32(uint256(2)), bytes32(uint256(3))];
        (bytes32 root, bytes32[][4] memory p) = tree4(l);
        vm.prank(owner);
        rewards.setRoot(root, 1);

        vm.expectRevert();
        rewards.claim(alice, one(address(rivl), 2_000_000e18, p[0]));
        assertEq(rewards.claimed(alice, address(rivl)), 0);

        rivl.mint(address(rewards), 1_000_000e18);
        rewards.claim(alice, one(address(rivl), 2_000_000e18, p[0]));
        assertEq(rivl.balanceOf(alice), 2_000_000e18);
    }

    function test_OnlyOwnerSetsRootAndEpochMustIncrease() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        rewards.setRoot(bytes32(uint256(1)), 1);

        vm.startPrank(owner);
        rewards.setRoot(bytes32(uint256(1)), 5);
        vm.expectRevert(RivlRewards.EpochNotIncreasing.selector);
        rewards.setRoot(bytes32(uint256(2)), 5);
        vm.stopPrank();
        assertEq(rewards.epoch(), 5);
    }

    function test_OwnerWithdrawsUnusedBudget() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        rewards.withdraw(address(rivl), alice, 1);

        vm.startPrank(owner);
        rewards.withdraw(address(rivl), owner, 400_000e18);
        rewards.withdraw(ETH, owner, 1 ether);
        vm.stopPrank();
        assertEq(rivl.balanceOf(owner), 400_000e18);
        assertEq(owner.balance, 1 ether);
    }
}
