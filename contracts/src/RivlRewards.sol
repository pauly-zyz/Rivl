// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title RivlRewards
/// @notice Klaim mingguan hadiah Daily Spin (token RIVL) dan pengembalian fee duel (ETH / USDG).
/// @dev Terpisah total dari DuelArena: tidak memegang dana pemain, hanya anggaran hadiah dari treasury.
///      Owner memposting satu Merkle root per minggu berisi jumlah KUMULATIF per (akun, token).
///      Yang dibayar saat klaim = kumulatif − yang sudah diklaim, jadi root baru tidak pernah membuat
///      hadiah dibayar dua kali dan klaim yang terlewat tetap bisa diambil kapan saja.
///      Pembayaran tidak bisa melebihi saldo contract: itulah batas anggaran (klaim gagal jika dana kurang,
///      dan bisa diulang setelah owner menambah dana).
///      Daun Merkle: keccak256(bytes.concat(keccak256(abi.encode(account, token, cumulativeAmount)))).
///      token = address(0) berarti ETH.
contract RivlRewards is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Claim {
        address token;
        uint256 cumulativeAmount;
        bytes32[] proof;
    }

    bytes32 public merkleRoot;
    /// @notice Nomor minggu dari root terakhir; harus selalu naik.
    uint64 public epoch;
    uint64 public rootUpdatedAt;

    /// @notice Total yang sudah diklaim per akun per token.
    mapping(address account => mapping(address token => uint256)) public claimed;

    event RootUpdated(uint64 indexed epoch, bytes32 root);
    event Claimed(address indexed account, address indexed token, uint256 amount, uint256 cumulativeAmount);
    event Funded(address indexed from, uint256 amount);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);

    error EpochNotIncreasing();
    error InvalidProof();
    error NothingToClaim();
    error TransferFailed();
    error ZeroAddress();

    constructor(address owner_) Ownable(owner_) {}

    receive() external payable {
        emit Funded(msg.sender, msg.value);
    }

    // -----------------------------------------------------------------------
    // Owner
    // -----------------------------------------------------------------------

    function setRoot(bytes32 root, uint64 newEpoch) external onlyOwner {
        if (newEpoch <= epoch) revert EpochNotIncreasing();
        merkleRoot = root;
        epoch = newEpoch;
        rootUpdatedAt = uint64(block.timestamp);
        emit RootUpdated(newEpoch, root);
    }

    /// @notice Tarik sisa anggaran hadiah (bukan dana pemain: contract ini tidak pernah memegang taruhan).
    function withdraw(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        _pay(token, to, amount);
        emit Withdrawn(token, to, amount);
    }

    // -----------------------------------------------------------------------
    // Klaim
    // -----------------------------------------------------------------------

    /// @notice Jumlah yang bisa diklaim sekarang untuk satu daun (0 jika bukti salah atau sudah diklaim).
    function claimableAmount(address account, address token, uint256 cumulativeAmount, bytes32[] calldata proof)
        external
        view
        returns (uint256)
    {
        if (!MerkleProof.verifyCalldata(proof, merkleRoot, _leaf(account, token, cumulativeAmount))) return 0;
        uint256 done = claimed[account][token];
        return cumulativeAmount > done ? cumulativeAmount - done : 0;
    }

    /// @notice Klaim semua token sekaligus. Hadiah selalu dikirim ke `account`, siapa pun pengirim transaksinya.
    function claim(address account, Claim[] calldata claims) external nonReentrant {
        uint256 paid;
        for (uint256 i; i < claims.length; ++i) {
            Claim calldata c = claims[i];
            if (!MerkleProof.verifyCalldata(c.proof, merkleRoot, _leaf(account, c.token, c.cumulativeAmount))) {
                revert InvalidProof();
            }
            uint256 done = claimed[account][c.token];
            if (c.cumulativeAmount <= done) continue;
            uint256 amount = c.cumulativeAmount - done;
            claimed[account][c.token] = c.cumulativeAmount;
            _pay(c.token, account, amount);
            emit Claimed(account, c.token, amount, c.cumulativeAmount);
            ++paid;
        }
        if (paid == 0) revert NothingToClaim();
    }

    function _leaf(address account, address token, uint256 cumulativeAmount) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(account, token, cumulativeAmount))));
    }

    function _pay(address token, address to, uint256 amount) internal {
        if (token == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }
}
