// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {CarveToken} from "../CarveToken.sol";
import {CarveContentRegistry} from "../CarveContentRegistry.sol";
import {CarveEscrow} from "../CarveEscrow.sol";
import {CarveV3Locker} from "./CarveV3Locker.sol";
import {CarveV3Math} from "./CarveV3Math.sol";
import {CarveInlineContent} from "./CarveInlineContent.sol";
import {CarveV3Addresses, ICarveERC20, ICarveWETH, ICarveV3Factory,
    ICarveV3PositionManager, ICarveV3SwapRouter} from "./CarveV3Interfaces.sol";

/// @notice Atomic onchain-media ERC20 + canonical Uniswap V3 pool + permanently locked launch liquidity.
/// @dev Local implementation candidate; canonical LP fees are NOT a guaranteed 1% gross platform tax.
/// Optional creator trading fees are intentionally absent rather than silently imposed on external routers.
contract CarveFactoryV3 is CarveEscrow {
    struct LaunchParams {
        string name; string symbol; bytes32 userSalt;
        bytes32 imageRoot; bytes32 audioRoot; bytes32 websiteRoot;
        uint256 minTokensOut; uint160 sqrtPriceLimitX96; uint256 deadline;
    }
    uint256 public constant supply = 1_000_000_000e18;
    uint256 public constant creationFee = 0.0005 ether;
    uint24 public constant poolFee = 10_000;
    uint256 public constant milestoneETH = 4.2 ether;
    CarveContentRegistry public immutable registry;
    address public immutable platformRecipient;
    CarveV3Locker public immutable locker;
    address[] public tokens;
    mapping(address => address) public poolForToken;
    mapping(address => uint256) public positionIdForToken;
    error InvalidDependencies();
    error InvalidLaunch();
    error InvalidContent();
    error InvalidInitialBuy();
    error UnexpectedETH();
    event Launched(address indexed creator, address indexed token, address indexed pool,
        uint256 positionId, bytes32 imageRoot, bytes32 audioRoot, bytes32 websiteRoot,
        uint256 initialBuySpent, uint256 initialTokensOut);

    constructor(CarveContentRegistry registry_, address platformRecipient_) {
        if (block.chainid != 4663 || address(registry_).code.length == 0 || platformRecipient_ == address(0)
            || CarveV3Addresses.FACTORY.code.length == 0 || CarveV3Addresses.POSITION_MANAGER.code.length == 0
            || CarveV3Addresses.SWAP_ROUTER.code.length == 0 || CarveV3Addresses.WETH.code.length == 0)
            revert InvalidDependencies();
        ICarveV3PositionManager manager = ICarveV3PositionManager(CarveV3Addresses.POSITION_MANAGER);
        ICarveV3SwapRouter router = ICarveV3SwapRouter(CarveV3Addresses.SWAP_ROUTER);
        if (manager.factory() != CarveV3Addresses.FACTORY || manager.WETH9() != CarveV3Addresses.WETH
            || router.factory() != CarveV3Addresses.FACTORY || router.WETH9() != CarveV3Addresses.WETH
            || ICarveV3Factory(CarveV3Addresses.FACTORY).feeAmountTickSpacing(poolFee) != CarveV3Math.SPACING)
            revert InvalidDependencies();
        registry = registry_;
        platformRecipient = platformRecipient_;
        locker = new CarveV3Locker(address(this), platformRecipient_);
    }

    receive() external payable {
        // Unspent initial-buy WETH can only be unwrapped by the immutable canonical WETH contract.
        if (msg.sender != CarveV3Addresses.WETH) revert UnexpectedETH();
    }

    function launch(LaunchParams calldata params)
        external payable nonReentrant returns (address token, address pool, uint256 positionId)
    { return _launch(params, msg.sender); }

    /// @notice Small inscriptions, manifest registration, token, pool, locked liquidity and optional buy: one transaction.
    function launchWithContent(string calldata name, string calldata symbol, bytes32 userSalt,
        CarveInlineContent.Asset[3] calldata assets, uint256 minTokensOut, uint160 sqrtPriceLimitX96, uint256 deadline)
        external payable nonReentrant returns (address token, address pool, uint256 positionId)
    {
        bytes32[3] memory roots = CarveInlineContent.prepare(registry, assets);
        return _launch(LaunchParams(name, symbol, userSalt, roots[0], roots[1], roots[2],
            minTokensOut, sqrtPriceLimitX96, deadline), msg.sender);
    }

    function _launch(LaunchParams memory p, address creator)
        private returns (address token, address pool, uint256 positionId)
    {
        if (bytes(p.name).length == 0 || bytes(p.name).length > 64 || bytes(p.symbol).length == 0
            || bytes(p.symbol).length > 12 || p.deadline < block.timestamp || msg.value < creationFee)
            revert InvalidLaunch();
        if ((p.imageRoot == 0 && p.audioRoot == 0 && p.websiteRoot == 0)
            || (p.imageRoot != 0 && !registry.exists(p.imageRoot))
            || (p.audioRoot != 0 && !registry.exists(p.audioRoot))
            || (p.websiteRoot != 0 && !registry.exists(p.websiteRoot))) revert InvalidContent();
        uint256 initialBuy = msg.value - creationFee;
        // Zero is the canonical router's direction-safe default limit. Mandatory minTokensOut
        // still bounds execution. Inline roots can change token address order if another writer
        // advances the registry nonce before mining, so clients need not predict that order.
        if ((initialBuy == 0 && (p.minTokensOut != 0 || p.sqrtPriceLimitX96 != 0))
            || (initialBuy != 0 && p.minTokensOut == 0)) revert InvalidInitialBuy();
        _credit(platformRecipient, creationFee);
        // User-chosen salt allows a fresh address if an adversary pre-initializes the predicted pool.
        token = address(new CarveToken{salt: keccak256(abi.encode(creator, p.userSalt))}(
            p.name, p.symbol, supply, creator, address(registry), p.imageRoot, p.audioRoot,
            p.websiteRoot, address(locker)
        ));
        (pool, positionId) = locker.createAndLock(token, p.deadline);
        poolForToken[token] = pool;
        positionIdForToken[token] = positionId;
        tokens.push(token);
        uint256 spent; uint256 bought;
        if (initialBuy != 0) (spent, bought) = _initialBuy(token, creator, initialBuy, p);
        emit Launched(creator, token, pool, positionId, p.imageRoot, p.audioRoot, p.websiteRoot, spent, bought);
    }

    function _initialBuy(address token, address creator, uint256 amount, LaunchParams memory p)
        private returns (uint256 spent, uint256 bought)
    {
        ICarveWETH weth = ICarveWETH(CarveV3Addresses.WETH);
        uint256 beforeWETH = weth.balanceOf(address(this));
        uint256 beforeToken = ICarveERC20(token).balanceOf(creator);
        weth.deposit{value: amount}();
        if (weth.balanceOf(address(this)) - beforeWETH != amount
            || !weth.approve(CarveV3Addresses.SWAP_ROUTER, amount)) revert InvalidInitialBuy();
        bought = ICarveV3SwapRouter(CarveV3Addresses.SWAP_ROUTER).exactInputSingle(
            ICarveV3SwapRouter.ExactInputSingleParams(CarveV3Addresses.WETH, token, poolFee, creator,
                amount, p.minTokensOut, p.sqrtPriceLimitX96)
        );
        if (!weth.approve(CarveV3Addresses.SWAP_ROUTER, 0)
            || weth.allowance(address(this), CarveV3Addresses.SWAP_ROUTER) != 0
            || ICarveERC20(token).balanceOf(creator) - beforeToken != bought || bought < p.minTokensOut)
            revert InvalidInitialBuy();
        uint256 unspent = weth.balanceOf(address(this)) - beforeWETH;
        if (unspent > amount) revert InvalidInitialBuy();
        spent = amount - unspent;
        if (spent == 0) revert InvalidInitialBuy();
        if (unspent != 0) {
            weth.withdraw(unspent);
            // Recipient contracts cannot block launch by rejecting refunds.
            _credit(creator, unspent);
        }
    }

    function predictToken(LaunchParams calldata p, address creator) external view returns (address) {
        bytes32 initCodeHash = keccak256(abi.encodePacked(type(CarveToken).creationCode,
            abi.encode(p.name, p.symbol, supply, creator, address(registry), p.imageRoot,
                p.audioRoot, p.websiteRoot, address(locker))));
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this),
            keccak256(abi.encode(creator, p.userSalt)), initCodeHash)))));
    }

    function tokenCount() external view returns (uint256) { return tokens.length; }
}
