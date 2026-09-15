// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {CarveToken} from "./CarveToken.sol";
import {CarveEscrow} from "./CarveEscrow.sol";

/// @notice Prototype native ETH constant-product market. Graduation is deliberately unavailable.
/// @dev Every product is bounded: token reserves <= 1e36 and ETH terms <= 2e30.
///      Trading fees and payouts are escrow liabilities separate from the curve reserve.
contract CarveMarket is CarveEscrow {
    struct Config {
        uint256 supply;
        uint256 virtualETH;
        uint256 capETH;
        uint16 tradeFeeBps;
        uint16 creatorFeeShareBps;
        address protocolRecipient;
    }
    uint256 private constant BPS = 10_000;
    CarveToken public immutable token;
    address public immutable creator;
    address public immutable factory;
    address public immutable protocolRecipient;
    uint256 public immutable virtualETH;
    uint256 public immutable capETH;
    uint16 public immutable tradeFeeBps;
    uint16 public immutable creatorFeeShareBps;
    uint256 public reserveETH;
    uint256 public inventory;

    error InvalidConfig();
    error DeadlineExpired();
    error ZeroTrade();
    error Slippage();
    error InvalidAmount();
    error CapReached();
    event Bought(address indexed buyer, uint256 grossETH, uint256 tokensOut, uint256 fee, uint256 refund);
    event Sold(address indexed seller, uint256 tokensIn, uint256 ethOut, uint256 fee);
    event ReserveCapReached(uint256 reserveETH);

    constructor(
        address creator_, address registry_, string memory name_, string memory symbol_,
        bytes32 image_, bytes32 audio_, bytes32 website_, Config memory config,
        uint256 minTokensOut, uint256 deadline
    ) payable {
        validateConfig(config);
        if (creator_ == address(0)) revert InvalidConfig();
        factory = msg.sender; creator = creator_; protocolRecipient = config.protocolRecipient;
        virtualETH = config.virtualETH; capETH = config.capETH;
        tradeFeeBps = config.tradeFeeBps; creatorFeeShareBps = config.creatorFeeShareBps;
        inventory = config.supply;
        token = new CarveToken(name_, symbol_, config.supply, creator_, registry_, image_, audio_, website_, address(this));
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (msg.value != 0) _buy(creator_, msg.value, minTokensOut);
        else if (minTokensOut != 0) revert Slippage();
    }

    function validateConfig(Config memory config) public pure {
        if (config.supply < 1e18 || config.supply > 1e36 || config.virtualETH == 0 || config.virtualETH > 1e30
            || config.capETH == 0 || config.capETH > 1e30 || config.tradeFeeBps > 1_000
            || config.creatorFeeShareBps > BPS || config.protocolRecipient == address(0)) revert InvalidConfig();
    }

    function graduationEnabled() external pure returns (bool) { return false; }
    function capReached() external view returns (bool) { return reserveETH == capETH; }

    function quoteBuy(uint256 grossETH) public view returns (
        uint256 tokensOut, uint256 acceptedGross, uint256 fee, uint256 refund
    ) {
        uint256 remaining = capETH - reserveETH;
        if (remaining == 0 || grossETH == 0) return (0, 0, 0, grossETH);
        uint256 maximumGross = (remaining * BPS + (BPS - tradeFeeBps) - 1) / (BPS - tradeFeeBps);
        acceptedGross = grossETH < maximumGross ? grossETH : maximumGross;
        // ETH charged for fee rounds up; buyer never receives tokens for unpaid reserve.
        uint256 net = acceptedGross * (BPS - tradeFeeBps) / BPS;
        fee = acceptedGross - net;
        tokensOut = inventory * net / (virtualETH + reserveETH + net);
        refund = grossETH - acceptedGross;
    }

    function buy(uint256 minTokensOut, uint256 deadline) external payable nonReentrant returns (uint256 tokensOut) {
        if (block.timestamp > deadline) revert DeadlineExpired();
        return _buy(msg.sender, msg.value, minTokensOut);
    }

    function _buy(address buyer, uint256 grossETH, uint256 minTokensOut) private returns (uint256 tokensOut) {
        if (reserveETH == capETH) revert CapReached();
        uint256 acceptedGross; uint256 fee; uint256 refund;
        (tokensOut, acceptedGross, fee, refund) = quoteBuy(grossETH);
        if (tokensOut == 0) revert ZeroTrade();
        if (tokensOut < minTokensOut) revert Slippage();
        reserveETH += acceptedGross - fee;
        inventory -= tokensOut;
        _creditFees(fee);
        if (refund != 0) _credit(buyer, refund);
        token.transfer(buyer, tokensOut);
        emit Bought(buyer, acceptedGross, tokensOut, fee, refund);
        if (reserveETH == capETH) emit ReserveCapReached(reserveETH);
    }

    function quoteSell(uint256 tokensIn) public view returns (uint256 ethOut, uint256 fee) {
        if (tokensIn > token.totalSupply() - inventory) revert InvalidAmount();
        if (tokensIn == 0) return (0, 0);
        uint256 gross = (virtualETH + reserveETH) * tokensIn / (inventory + tokensIn);
        // A check, not a clamp: unexpected reserve math must never consume fee escrow.
        if (gross > reserveETH) revert InvalidAmount();
        ethOut = gross * (BPS - tradeFeeBps) / BPS;
        fee = gross - ethOut;
    }

    /// @notice Seller ETH becomes a withdrawable balance; ERC20 allowance is required.
    function sell(uint256 tokensIn, uint256 minETHOut, uint256 deadline) external nonReentrant returns (uint256 ethOut) {
        if (block.timestamp > deadline) revert DeadlineExpired();
        uint256 fee;
        (ethOut, fee) = quoteSell(tokensIn);
        if (ethOut == 0) revert ZeroTrade();
        if (ethOut < minETHOut) revert Slippage();
        reserveETH -= ethOut + fee;
        inventory += tokensIn;
        _creditFees(fee);
        _credit(msg.sender, ethOut);
        token.transferFrom(msg.sender, address(this), tokensIn);
        emit Sold(msg.sender, tokensIn, ethOut, fee);
    }

    function _creditFees(uint256 fee) private {
        uint256 creatorFee = fee * creatorFeeShareBps / BPS;
        _credit(creator, creatorFee);
        _credit(protocolRecipient, fee - creatorFee);
    }
}
