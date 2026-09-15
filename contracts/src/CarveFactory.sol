// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {CarveContentRegistry} from "./CarveContentRegistry.sol";
import {CarveMarket} from "./CarveMarket.sol";
import {CarveEscrow} from "./CarveEscrow.sol";

/// @notice Permissionless launch + optional initial buy, atomically, from finalized content.
/// @dev Economics are chosen once at deployment. No administrator can change existing markets.
contract CarveFactory is CarveEscrow {
    CarveContentRegistry public immutable registry;
    uint256 public immutable creationFee;
    address public immutable protocolRecipient;
    CarveMarket.Config public marketConfig;
    address[] public markets;
    mapping(address => address) public marketForToken;
    error InvalidLaunch();
    error InvalidContent();
    error InsufficientCreationFee();
    event Launched(address indexed creator, address indexed token, address indexed market,
        bytes32 imageRoot, bytes32 audioRoot, bytes32 websiteRoot);

    constructor(CarveContentRegistry registry_, uint256 creationFee_, CarveMarket.Config memory config) {
        if (address(registry_).code.length == 0 || creationFee_ > 1e30) revert InvalidLaunch();
        if (config.supply < 1e18 || config.supply > 1e36 || config.virtualETH == 0 || config.virtualETH > 1e30
            || config.capETH == 0 || config.capETH > 1e30 || config.tradeFeeBps > 1_000
            || config.creatorFeeShareBps > 10_000 || config.protocolRecipient == address(0)) revert InvalidLaunch();
        registry = registry_; creationFee = creationFee_; protocolRecipient = config.protocolRecipient;
        marketConfig = config;
    }

    function launch(string calldata name, string calldata symbol, bytes32 imageRoot,
        bytes32 audioRoot, bytes32 websiteRoot, uint256 minTokensOut, uint256 deadline)
        external payable nonReentrant returns (address token, address market)
    {
        if (bytes(name).length == 0 || bytes(name).length > 64 || bytes(symbol).length == 0 || bytes(symbol).length > 12)
            revert InvalidLaunch();
        if (msg.value < creationFee) revert InsufficientCreationFee();
        if (imageRoot == 0 || !registry.exists(imageRoot)
            || (audioRoot != 0 && !registry.exists(audioRoot)) || (websiteRoot != 0 && !registry.exists(websiteRoot)))
            revert InvalidContent();
        _credit(protocolRecipient, creationFee);
        CarveMarket deployed = new CarveMarket{value: msg.value - creationFee}(
            msg.sender, address(registry), name, symbol, imageRoot, audioRoot, websiteRoot,
            marketConfig, minTokensOut, deadline
        );
        token = address(deployed.token()); market = address(deployed);
        markets.push(market);
        marketForToken[token] = market;
        emit Launched(msg.sender, token, market, imageRoot, audioRoot, websiteRoot);
    }

    function marketCount() external view returns (uint256) { return markets.length; }
}
