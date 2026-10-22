// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {DuelArena} from "../../src/DuelArena.sol";

/// @notice Stablecoin tiruan 6 desimal untuk test.
contract MockUSDG is ERC20 {
    constructor() ERC20("Mock Global Dollar", "USDG") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice Token yang memotong 1% setiap transfer, untuk memastikan ditolak.
contract FeeOnTransferToken is ERC20 {
    constructor() ERC20("Fee Token", "FEE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 cut = value / 100;
            super._update(from, address(0xdead), cut);
            super._update(from, to, value - cut);
        } else {
            super._update(from, to, value);
        }
    }
}

/// @notice Pemain jahat yang mencoba reentrancy saat menerima ETH dari `withdraw`.
contract ReentrantPlayer {
    DuelArena public immutable arena;
    bool private attacking;

    constructor(DuelArena arena_) {
        arena = arena_;
    }

    function createAndCancel(uint256 amount) external payable {
        uint256 id = arena.createCoinflip{value: amount}(address(0), amount, 0);
        arena.cancel(id);
    }

    function attack() external {
        attacking = true;
        arena.withdraw(address(0));
    }

    receive() external payable {
        if (attacking) {
            attacking = false;
            arena.withdraw(address(0));
        }
    }
}
