// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {CarveToken} from "./CarveToken.sol";
import {CarveEscrow} from "./CarveEscrow.sol";
import {CarveFeePolicy} from "./CarveFeePolicy.sol";
import {CarveCurveValidation} from "./CarveCurveValidation.sol";
import {ICarveMigrationAdapterV2} from "./interfaces/ICarveMigrationAdapterV2.sol";

/// @notice Versioned ETH curve with fixed Carve fees and a permanent per-launch creator fee.
contract CarveMarketV2 is CarveEscrow {
    enum Phase { Curve, Migrating, Graduated }

    struct Config {
        uint256 supply;
        uint256 virtualETH;
        uint256 capETH;
        uint16 creatorFeeLimitBps;
        address platformRecipient;
        address migrationAdapter;
        address locker;
    }

    uint16 public constant platformFeeBps = 100;
    CarveToken public immutable token;
    address public immutable creator;
    address public immutable factory;
    address public immutable platformRecipient;
    address public immutable migrationAdapter;
    address public immutable locker;
    uint256 public immutable virtualETH;
    uint256 public immutable capETH;
    uint16 public immutable creatorFeeBps;
    uint16 public immutable creatorFeeLimitBps;
    uint256 public reserveETH;
    uint256 public inventory;
    /// @notice Lifetime executed native reserve-leg volume: net buys plus pre-fee sale output.
    uint256 public curveVolumeETH;
    Phase public phase;
    ICarveMigrationAdapterV2.MigrationReceipt private completedMigration;

    error InvalidConfig();
    error WrongPhase();
    error DeadlineExpired();
    error ZeroTrade();
    error Slippage();
    error InvalidAmount();
    error CapReached();
    error TokenTransferFailed();
    error GraduationNotReady();
    error InvalidMigrationReceipt();
    error MigrationAccountingMismatch();

    event Bought(address indexed buyer, uint256 acceptedGross, uint256 tokensOut,
        uint256 platformFee, uint256 creatorFee, uint256 refund);
    event Sold(address indexed seller, uint256 tokensIn, uint256 ethOut,
        uint256 platformFee, uint256 creatorFee);
    event ReserveCapReached(uint256 reserveETH);
    event Graduated(bytes32 indexed poolId, uint128 liquidity, uint256 ethSpent, uint256 tokensSpent,
        uint256 lockedETH, uint256 lockedTokens);

    constructor(address creator_, address registry_, string memory name_, string memory symbol_,
        bytes32 image_, bytes32 audio_, bytes32 website_, uint16 creatorFeeBps_, Config memory config,
        uint256 minTokensOut, uint256 deadline) payable
    {
        CarveCurveValidation.validate(config.supply, config.virtualETH, config.capETH);
        CarveFeePolicy.validate(creatorFeeBps_, config.creatorFeeLimitBps);
        if (creator_ == address(0) || registry_.code.length == 0 || config.platformRecipient == address(0)
            || config.migrationAdapter.code.length == 0 || config.locker != config.migrationAdapter) revert InvalidConfig();
        factory = msg.sender;
        creator = creator_;
        platformRecipient = config.platformRecipient;
        migrationAdapter = config.migrationAdapter;
        locker = config.locker;
        virtualETH = config.virtualETH;
        capETH = config.capETH;
        creatorFeeBps = creatorFeeBps_;
        creatorFeeLimitBps = config.creatorFeeLimitBps;
        inventory = config.supply;
        token = new CarveToken(name_, symbol_, config.supply, creator_, registry_, image_, audio_, website_, address(this));
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (msg.value != 0) _buy(creator_, msg.value, minTokensOut);
        else if (minTokensOut != 0) revert Slippage();
    }

    function capReached() external view returns (bool) { return phase == Phase.Curve && reserveETH == capETH; }
    function canGraduate() external view returns (bool) { return phase == Phase.Curve && reserveETH == capETH; }
    function graduationEnabled() external pure returns (bool) { return true; }

    function graduationReceipt() external view returns (ICarveMigrationAdapterV2.MigrationReceipt memory) {
        return completedMigration;
    }

    /// @notice Anyone can graduate at the accounted reserve cap; beneficiaries and destination are fixed.
    /// @dev A failed external call or verification reverts initialization, transfers and phase together.
    ///      Old curve credits remain withdrawable. Pre-existing unsolicited ETH/token donations stay here.
    function graduate(uint128 minLiquidity, uint256 deadline) external nonReentrant
        returns (ICarveMigrationAdapterV2.MigrationReceipt memory receipt)
    {
        return _graduate(minLiquidity, deadline);
    }

    function _graduate(uint128 minLiquidity, uint256 deadline) private
        returns (ICarveMigrationAdapterV2.MigrationReceipt memory receipt)
    {
        _requireCurve();
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (reserveETH != capETH) revert GraduationNotReady();
        uint256 reserveBefore = reserveETH;
        uint256 inventoryBefore = inventory;
        uint256 creditsBefore = totalPendingETH;
        uint256 ethBefore = address(this).balance;
        uint256 tokensBefore = token.balanceOf(address(this));
        if (ethBefore < reserveBefore + creditsBefore || tokensBefore < inventoryBefore) revert MigrationAccountingMismatch();

        phase = Phase.Migrating;
        if (!token.approve(migrationAdapter, inventoryBefore)) revert TokenTransferFailed();
        ICarveMigrationAdapterV2 engine = ICarveMigrationAdapterV2(migrationAdapter);
        receipt = engine.migrate{value: reserveBefore}(address(token), inventoryBefore, minLiquidity, deadline);
        if (!token.approve(migrationAdapter, 0)) revert TokenTransferFailed();

        if (receipt.poolId == 0 || receipt.liquidity == 0 || receipt.liquidity < minLiquidity
            || receipt.ethSpent > reserveBefore || receipt.lockedETH != reserveBefore - receipt.ethSpent
            || receipt.tokensSpent > inventoryBefore || receipt.lockedTokens != inventoryBefore - receipt.tokensSpent)
            revert InvalidMigrationReceipt();
        if (keccak256(abi.encode(receipt)) != keccak256(abi.encode(engine.getReceipt(address(this))))
            || !engine.verifyPosition(address(this))) revert InvalidMigrationReceipt();
        if (address(this).balance != ethBefore - reserveBefore
            || token.balanceOf(address(this)) != tokensBefore - inventoryBefore
            || totalPendingETH != creditsBefore || address(this).balance < creditsBefore)
            revert MigrationAccountingMismatch();

        reserveETH = 0;
        inventory = 0;
        completedMigration = receipt;
        phase = Phase.Graduated;
        emit Graduated(receipt.poolId, receipt.liquidity, receipt.ethSpent, receipt.tokensSpent,
            receipt.lockedETH, receipt.lockedTokens);
    }

    function quoteBuy(uint256 grossETH) public view returns (uint256 tokensOut, uint256 acceptedGross,
        uint256 platformFee, uint256 creatorFee, uint256 refund)
    {
        _requireCurve();
        CarveFeePolicy.CappedBuy memory quote = CarveFeePolicy.cappedBuy(
            grossETH, capETH - reserveETH, creatorFeeBps, creatorFeeLimitBps
        );
        tokensOut = inventory * quote.net / (virtualETH + reserveETH + quote.net);
        return (tokensOut, quote.acceptedGross, quote.platformFee, quote.creatorFee, quote.refund);
    }

    function buy(uint256 minTokensOut, uint256 deadline) external payable nonReentrant returns (uint256 tokensOut) {
        if (block.timestamp > deadline) revert DeadlineExpired();
        tokensOut = _buy(msg.sender, msg.value, minTokensOut);
        if (reserveETH == capETH) _graduate(0, deadline);
    }

    function _buy(address buyer, uint256 grossETH, uint256 minTokensOut) private returns (uint256 tokensOut) {
        _requireCurve();
        if (reserveETH == capETH) revert CapReached();
        uint256 acceptedGross;
        uint256 platformFee;
        uint256 creatorFee;
        uint256 refund;
        (tokensOut, acceptedGross, platformFee, creatorFee, refund) = quoteBuy(grossETH);
        if (tokensOut == 0) revert ZeroTrade();
        if (tokensOut < minTokensOut) revert Slippage();
        uint256 nativeLeg = acceptedGross - platformFee - creatorFee;
        reserveETH += nativeLeg;
        curveVolumeETH += nativeLeg;
        inventory -= tokensOut;
        _credit(platformRecipient, platformFee);
        _credit(creator, creatorFee);
        _credit(buyer, refund);
        if (!token.transfer(buyer, tokensOut)) revert TokenTransferFailed();
        emit Bought(buyer, acceptedGross, tokensOut, platformFee, creatorFee, refund);
        if (reserveETH == capETH) emit ReserveCapReached(reserveETH);
    }

    function quoteSell(uint256 tokensIn) public view returns (uint256 ethOut, uint256 platformFee, uint256 creatorFee) {
        _requireCurve();
        if (tokensIn > token.totalSupply() - inventory) revert InvalidAmount();
        if (tokensIn == 0) return (0, 0, 0);
        uint256 gross = (virtualETH + reserveETH) * tokensIn / (inventory + tokensIn);
        if (gross > reserveETH) revert InvalidAmount();
        CarveFeePolicy.Amounts memory amounts = CarveFeePolicy.fromGross(gross, creatorFeeBps, creatorFeeLimitBps);
        return (amounts.net, amounts.platformFee, amounts.creatorFee);
    }

    /// @notice ETH sale proceeds become the seller's withdrawable credit; ERC20 allowance is required.
    function sell(uint256 tokensIn, uint256 minETHOut, uint256 deadline) external nonReentrant returns (uint256 ethOut) {
        if (block.timestamp > deadline) revert DeadlineExpired();
        uint256 platformFee;
        uint256 creatorFee;
        (ethOut, platformFee, creatorFee) = quoteSell(tokensIn);
        if (ethOut == 0) revert ZeroTrade();
        if (ethOut < minETHOut) revert Slippage();
        reserveETH -= ethOut + platformFee + creatorFee;
        curveVolumeETH += ethOut + platformFee + creatorFee;
        inventory += tokensIn;
        _credit(platformRecipient, platformFee);
        _credit(creator, creatorFee);
        _credit(msg.sender, ethOut);
        if (!token.transferFrom(msg.sender, address(this), tokensIn)) revert TokenTransferFailed();
        emit Sold(msg.sender, tokensIn, ethOut, platformFee, creatorFee);
    }

    function _requireCurve() private view {
        if (phase != Phase.Curve) revert WrongPhase();
    }
}
