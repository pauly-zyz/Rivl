// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title DuelArena — game PvP 1 lawan 1 dengan taruhan ETH atau USDG
/// @notice Game: Coinflip, Dice Duel, Suit (Gunting-Batu-Kertas).
///         Platform tidak pernah melawan pemain: dana kedua pemain dikunci (escrow),
///         pemenang mendapat pot dikurangi fee, fee masuk ke treasury.
/// @dev Semua game memakai commit-reveal antar pemain, tanpa oracle atau operator:
///      - Pembuat mengirim commit (hash dari pilihan/rahasia + salt) saat membuat duel.
///      - Penerima bergabung dengan pilihannya (Suit) atau seed acak miliknya (Coinflip/Dice).
///      - Pembuat membuka commit. Coinflip/Dice: angka acak = keccak256(salt, seed penerima).
///      - Pembuat yang tidak membuka sebelum batas waktu kalah, jadi menahan rahasia tidak menguntungkan.
///      Prinsip keamanan:
///      - Pull payment: hasil dikreditkan ke `claimable`, pemain menarik sendiri via `withdraw`.
///      - Owner TIDAK bisa menyentuh dana pemain; `rescue` hanya untuk kelebihan saldo.
///      - Fee dikunci saat duel dibuat (owner tidak bisa menaikkan fee duel yang sudah ada).
///      - Setiap status "menunggu" punya batas waktu, jadi dana tidak bisa terjebak selamanya.
contract DuelArena is Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------
    // Tipe
    // ------------------------------------------------------------------

    enum GameType {
        Coinflip,
        Dice,
        Suit
    }

    enum Status {
        None,
        Open, // menunggu lawan
        AwaitingReveal, // menunggu pembuat membuka commit
        Settled, // ada pemenang
        Draw, // seri, dana dikembalikan tanpa fee
        Cancelled // dibatalkan pembuat sebelum ada lawan
    }

    struct Duel {
        address creator;
        address joiner;
        address token; // address(0) = ETH
        address winner; // address(0) jika seri/batal
        uint256 amount; // taruhan per pemain
        uint256 randomWord; // Coinflip/Dice: keccak256(abi.encode(salt, joinerSeed)), disimpan untuk transparansi
        bytes32 commit; // hash pilihan/rahasia pembuat
        bytes32 joinerSeed; // Coinflip/Dice: seed acak dari penerima
        bytes32 salt; // salt pembuat, terisi setelah reveal
        uint64 createdAt;
        uint64 expiresAt; // batas waktu duel bisa diterima
        uint64 joinedAt;
        uint64 deadline; // batas waktu reveal
        uint16 feeBpsAtCreate;
        GameType game;
        Status status;
        uint8 creatorChoice; // Coinflip: sisi (0/1). Suit: pilihan yang dibuka
        uint8 joinerChoice; // Suit: pilihan penerima
        uint8 creatorResult; // Coinflip: hasil lemparan (0/1). Dice: angka pembuat
        uint8 joinerResult; // Dice: angka penerima
    }

    struct TokenConfig {
        bool allowed;
        uint128 minStake;
        uint128 maxStake;
    }

    // ------------------------------------------------------------------
    // Konstanta
    // ------------------------------------------------------------------

    uint8 public constant HEADS = 0;
    uint8 public constant TAILS = 1;

    uint8 public constant ROCK = 1; // Batu
    uint8 public constant PAPER = 2; // Kertas
    uint8 public constant SCISSORS = 3; // Gunting

    /// @notice Nilai `move` di commit Coinflip/Dice. Rahasianya hanya salt.
    uint8 public constant NO_MOVE = 0;

    uint16 public constant BPS = 10_000;
    uint16 public constant MAX_FEE_BPS = 1_000; // maksimal 10%

    // ------------------------------------------------------------------
    // State
    // ------------------------------------------------------------------

    uint16 public feeBps;
    address public treasury;

    uint64 public openDuration = 24 hours;
    uint64 public revealWindow = 1 hours;

    uint256 public nextDuelId = 1;

    mapping(uint256 => Duel) private _duels;
    mapping(bytes32 => bool) public commitUsed;
    mapping(address => TokenConfig) public tokenConfig;

    /// @notice Saldo yang bisa ditarik: user => token => jumlah.
    mapping(address => mapping(address => uint256)) public claimable;
    /// @notice Total yang masih terkunci di duel aktif, per token.
    mapping(address => uint256) public escrowed;
    /// @notice Total `claimable` seluruh user, per token.
    mapping(address => uint256) public totalClaimable;

    // ------------------------------------------------------------------
    // Event
    // ------------------------------------------------------------------

    event DuelCreated(
        uint256 indexed id,
        address indexed creator,
        GameType game,
        address token,
        uint256 amount,
        uint8 creatorChoice,
        bytes32 commit,
        uint64 expiresAt
    );
    event DuelJoined(uint256 indexed id, address indexed joiner, uint8 joinerChoice, bytes32 joinerSeed, uint64 deadline);
    event Revealed(uint256 indexed id, uint8 move, bytes32 salt);
    event DuelSettled(
        uint256 indexed id, address indexed winner, address token, uint256 payout, uint256 fee, uint256 randomWord
    );
    event DuelDrawn(uint256 indexed id);
    event DuelCancelled(uint256 indexed id);
    event Withdrawn(address indexed user, address indexed token, uint256 amount);

    event FeeUpdated(uint16 feeBps);
    event TreasuryUpdated(address treasury);
    event TokenConfigUpdated(address indexed token, bool allowed, uint128 minStake, uint128 maxStake);
    event TimingsUpdated(uint64 openDuration, uint64 revealWindow);
    event Rescued(address indexed token, address indexed to, uint256 amount);

    // ------------------------------------------------------------------
    // Error
    // ------------------------------------------------------------------

    error ZeroAddress();
    error FeeTooHigh();
    error TokenNotAllowed();
    error StakeOutOfRange();
    error WrongEthValue();
    error UnsupportedToken();
    error InvalidSide();
    error InvalidMove();
    error InvalidSeed();
    error InvalidCommit();
    error CommitAlreadyUsed();
    error InvalidStatus();
    error DuelExpired();
    error CannotJoinOwnDuel();
    error NotCreator();
    error RevealWindowClosed();
    error InvalidReveal();
    error TooEarly();
    error NothingToWithdraw();
    error EthTransferFailed();
    error InvalidConfig();

    // ------------------------------------------------------------------
    // Constructor
    // ------------------------------------------------------------------

    constructor(address initialOwner, address treasury_, uint16 feeBps_) Ownable(initialOwner) {
        if (treasury_ == address(0)) revert ZeroAddress();
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh();
        treasury = treasury_;
        feeBps = feeBps_;
    }

    // ------------------------------------------------------------------
    // Membuat duel
    // ------------------------------------------------------------------

    /// @notice Buat duel Coinflip. Pembuat memilih sisi, penerima otomatis mendapat sisi lawannya.
    /// @param commit `computeCommit(creator, NO_MOVE, salt)`; salt 32 byte acak dan baru, dihitung di browser.
    function createCoinflip(address token, uint256 amount, uint8 side, bytes32 commit)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (uint256 id)
    {
        if (side > TAILS) revert InvalidSide();
        _useCommit(commit);
        id = _create(GameType.Coinflip, token, amount, side, commit);
    }

    /// @notice Buat Dice Duel. Kedua pemain mendapat angka 1–100, angka tertinggi menang, seri = refund.
    /// @param commit `computeCommit(creator, NO_MOVE, salt)`; salt 32 byte acak dan baru, dihitung di browser.
    function createDice(address token, uint256 amount, bytes32 commit)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (uint256 id)
    {
        _useCommit(commit);
        id = _create(GameType.Dice, token, amount, 0, commit);
    }

    /// @notice Buat duel Suit dengan pilihan yang disembunyikan.
    /// @param commit `computeCommit(creator, move, salt)`; salt 32 byte acak dan baru, dihitung di browser.
    function createSuit(address token, uint256 amount, bytes32 commit)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (uint256 id)
    {
        _useCommit(commit);
        id = _create(GameType.Suit, token, amount, 0, commit);
    }

    // ------------------------------------------------------------------
    // Menerima duel
    // ------------------------------------------------------------------

    /// @notice Terima duel. Kirim taruhan yang sama dengan pembuat.
    /// @param move Suit: 1 = Batu, 2 = Kertas, 3 = Gunting. Coinflip/Dice: isi 0.
    /// @param seed Coinflip/Dice: 32 byte acak dan baru dari penerima (bukan nol). Suit: isi 0.
    function join(uint256 id, uint8 move, bytes32 seed) external payable nonReentrant whenNotPaused {
        Duel storage d = _duels[id];
        if (d.status != Status.Open) revert InvalidStatus();
        if (block.timestamp > d.expiresAt) revert DuelExpired();
        if (msg.sender == d.creator) revert CannotJoinOwnDuel();
        if (d.game == GameType.Suit) {
            if (move < ROCK || move > SCISSORS) revert InvalidMove();
        } else {
            if (move != 0) revert InvalidMove();
            // Seed nol mudah ditebak pembuat sebelum membuat commit; tolak supaya tidak dipakai tanpa sengaja.
            if (seed == bytes32(0)) revert InvalidSeed();
        }

        // Nominal sudah divalidasi saat duel dibuat; perubahan config setelahnya
        // tidak boleh memblokir duel yang sudah ada.
        _pull(d.token, d.amount);

        d.joiner = msg.sender;
        d.joinedAt = uint64(block.timestamp);
        d.joinerChoice = move;
        if (d.game != GameType.Suit) d.joinerSeed = seed;
        d.status = Status.AwaitingReveal;
        d.deadline = uint64(block.timestamp) + revealWindow;

        emit DuelJoined(id, msg.sender, move, d.joinerSeed, d.deadline);
    }

    // ------------------------------------------------------------------
    // Penyelesaian
    // ------------------------------------------------------------------

    /// @notice Pembuat membuka commit-nya dan duel langsung selesai.
    /// @param move Suit: pilihan yang di-commit. Coinflip/Dice: 0 (NO_MOVE).
    /// @dev Jika hash cocok tapi nilai `move` tidak valid untuk game itu, pembuat dinyatakan kalah.
    function reveal(uint256 id, uint8 move, bytes32 salt) external nonReentrant {
        Duel storage d = _duels[id];
        if (d.status != Status.AwaitingReveal) revert InvalidStatus();
        if (msg.sender != d.creator) revert NotCreator();
        if (block.timestamp > d.deadline) revert RevealWindowClosed();
        if (computeCommit(d.creator, move, salt) != d.commit) revert InvalidReveal();

        d.salt = salt;
        emit Revealed(id, move, salt);

        if (d.game == GameType.Suit) {
            d.creatorChoice = move;
            if (move < ROCK || move > SCISSORS) {
                _settle(id, d, d.joiner);
            } else if (move == d.joinerChoice) {
                _draw(id, d);
            } else {
                // X mengalahkan Y jika X == (Y % 3) + 1  → Kertas>Batu, Gunting>Kertas, Batu>Gunting
                bool creatorWins = move == (d.joinerChoice % 3) + 1;
                _settle(id, d, creatorWins ? d.creator : d.joiner);
            }
            return;
        }

        if (move != NO_MOVE) {
            _settle(id, d, d.joiner);
            return;
        }

        // Pembuat mengunci salt sebelum seed penerima diketahui; penerima memilih seed tanpa tahu salt.
        uint256 randomWord = uint256(keccak256(abi.encode(salt, d.joinerSeed)));
        d.randomWord = randomWord;

        if (d.game == GameType.Coinflip) {
            uint8 result = uint8(randomWord % 2);
            d.creatorResult = result;
            _settle(id, d, result == d.creatorChoice ? d.creator : d.joiner);
        } else {
            // Dua angka independen dari 128 bit bawah dan 128 bit atas.
            uint8 creatorRoll = uint8(uint128(randomWord) % 100) + 1;
            uint8 joinerRoll = uint8((randomWord >> 128) % 100) + 1;
            d.creatorResult = creatorRoll;
            d.joinerResult = joinerRoll;
            if (creatorRoll == joinerRoll) {
                _draw(id, d);
            } else {
                _settle(id, d, creatorRoll > joinerRoll ? d.creator : d.joiner);
            }
        }
    }

    /// @notice Jika pembuat tidak membuka commit sebelum batas waktu, penerima menang.
    ///         Siapa pun boleh memanggil; hadiah tetap masuk ke penerima.
    function claimRevealTimeout(uint256 id) external nonReentrant {
        Duel storage d = _duels[id];
        if (d.status != Status.AwaitingReveal) revert InvalidStatus();
        if (block.timestamp <= d.deadline) revert TooEarly();
        _settle(id, d, d.joiner);
    }

    /// @notice Pembuat membatalkan duel yang belum diterima siapa pun (termasuk yang sudah kedaluwarsa).
    function cancel(uint256 id) external nonReentrant {
        Duel storage d = _duels[id];
        if (d.status != Status.Open) revert InvalidStatus();
        if (msg.sender != d.creator) revert NotCreator();

        d.status = Status.Cancelled;
        escrowed[d.token] -= d.amount;
        _credit(d.creator, d.token, d.amount);
        emit DuelCancelled(id);
    }

    // ------------------------------------------------------------------
    // Penarikan
    // ------------------------------------------------------------------

    /// @notice Tarik seluruh saldo `claimable` untuk satu token (address(0) = ETH).
    function withdraw(address token) external nonReentrant {
        uint256 amount = claimable[msg.sender][token];
        if (amount == 0) revert NothingToWithdraw();

        claimable[msg.sender][token] = 0;
        totalClaimable[token] -= amount;

        _send(token, msg.sender, amount);
        emit Withdrawn(msg.sender, token, amount);
    }

    // ------------------------------------------------------------------
    // View
    // ------------------------------------------------------------------

    function getDuel(uint256 id) external view returns (Duel memory) {
        return _duels[id];
    }

    /// @notice Rumus commit untuk semua game. Terikat ke chain, kontrak ini, dan alamat pembuat,
    ///         jadi commit tidak bisa disalin orang lain. Coinflip/Dice memakai move = NO_MOVE (0).
    /// @dev Untuk produksi, hitung di browser (keccak256 dari abi.encode yang sama).
    ///      Memanggil fungsi ini lewat RPC mengirim pilihan + salt ke penyedia RPC.
    function computeCommit(address creator, uint8 move, bytes32 salt) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), creator, move, salt));
    }

    // ------------------------------------------------------------------
    // Admin (tidak ada fungsi untuk mengambil dana pemain)
    // ------------------------------------------------------------------

    function setFeeBps(uint16 newFeeBps) external onlyOwner {
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        feeBps = newFeeBps;
        emit FeeUpdated(newFeeBps);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        treasury = newTreasury;
        emit TreasuryUpdated(newTreasury);
    }

    function setTokenConfig(address token, bool allowed, uint128 minStake, uint128 maxStake) external onlyOwner {
        if (allowed && (minStake == 0 || minStake > maxStake)) revert InvalidConfig();
        tokenConfig[token] = TokenConfig(allowed, minStake, maxStake);
        emit TokenConfigUpdated(token, allowed, minStake, maxStake);
    }

    /// @dev Hanya berlaku untuk duel yang dibuat/diterima setelah perubahan.
    function setTimings(uint64 openDuration_, uint64 revealWindow_) external onlyOwner {
        if (openDuration_ < 5 minutes || openDuration_ > 7 days) revert InvalidConfig();
        if (revealWindow_ < 5 minutes || revealWindow_ > 1 days) revert InvalidConfig();
        openDuration = openDuration_;
        revealWindow = revealWindow_;
        emit TimingsUpdated(openDuration_, revealWindow_);
    }

    /// @notice Hentikan pembuatan & penerimaan duel baru. Batal, penyelesaian, dan penarikan tetap berjalan.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Ambil saldo berlebih (misalnya token yang terkirim tidak sengaja).
    ///         Tidak bisa menyentuh dana escrow maupun saldo `claimable` pemain.
    function rescue(address token, address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 balance = token == address(0) ? address(this).balance : IERC20(token).balanceOf(address(this));
        uint256 liabilities = escrowed[token] + totalClaimable[token];
        if (balance <= liabilities) revert NothingToWithdraw();
        uint256 excess = balance - liabilities;
        _send(token, to, excess);
        emit Rescued(token, to, excess);
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    function _useCommit(bytes32 commit) internal {
        if (commit == bytes32(0)) revert InvalidCommit();
        if (commitUsed[commit]) revert CommitAlreadyUsed();
        commitUsed[commit] = true;
    }

    function _create(GameType game, address token, uint256 amount, uint8 choice, bytes32 commit)
        internal
        returns (uint256 id)
    {
        TokenConfig memory c = tokenConfig[token];
        if (!c.allowed) revert TokenNotAllowed();
        if (amount < c.minStake || amount > c.maxStake) revert StakeOutOfRange();

        _pull(token, amount);

        id = nextDuelId++;
        Duel storage d = _duels[id];
        d.creator = msg.sender;
        d.token = token;
        d.amount = amount;
        d.commit = commit;
        d.createdAt = uint64(block.timestamp);
        d.expiresAt = uint64(block.timestamp) + openDuration;
        d.feeBpsAtCreate = feeBps;
        d.game = game;
        d.status = Status.Open;
        d.creatorChoice = choice;

        emit DuelCreated(id, msg.sender, game, token, amount, choice, commit, d.expiresAt);
    }

    /// @dev Tarik taruhan dari pemain ke escrow.
    function _pull(address token, uint256 amount) internal {
        if (token == address(0)) {
            if (msg.value != amount) revert WrongEthValue();
        } else {
            if (msg.value != 0) revert WrongEthValue();
            uint256 before = IERC20(token).balanceOf(address(this));
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
            // Tolak token dengan fee-on-transfer / rebasing.
            if (IERC20(token).balanceOf(address(this)) - before != amount) revert UnsupportedToken();
        }
        escrowed[token] += amount;
    }

    function _settle(uint256 id, Duel storage d, address winner) internal {
        uint256 pot = d.amount * 2;
        uint256 fee = (pot * d.feeBpsAtCreate) / BPS;
        uint256 payout = pot - fee;

        d.status = Status.Settled;
        d.winner = winner;
        escrowed[d.token] -= pot;

        _credit(winner, d.token, payout);
        if (fee > 0) _credit(treasury, d.token, fee);

        emit DuelSettled(id, winner, d.token, payout, fee, d.randomWord);
    }

    function _draw(uint256 id, Duel storage d) internal {
        d.status = Status.Draw;
        escrowed[d.token] -= d.amount * 2;
        _credit(d.creator, d.token, d.amount);
        _credit(d.joiner, d.token, d.amount);
        emit DuelDrawn(id);
    }

    function _credit(address user, address token, uint256 amount) internal {
        claimable[user][token] += amount;
        totalClaimable[token] += amount;
    }

    function _send(address token, address to, uint256 amount) internal {
        if (token == address(0)) {
            (bool ok,) = payable(to).call{value: amount}("");
            if (!ok) revert EthTransferFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }
}
