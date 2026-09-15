// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {CarveContentRegistry} from "./CarveContentRegistry.sol";
import {CarveMarketV2} from "./CarveMarketV2.sol";
import {CarveEscrow} from "./CarveEscrow.sol";
import {CarveFeePolicy} from "./CarveFeePolicy.sol";
import {CarveCurveValidation} from "./CarveCurveValidation.sol";
import {ICarveMigrationAdapterV2} from "./interfaces/ICarveMigrationAdapterV2.sol";

/// @notice Permissionless launches using the approved release economics and immutable dependencies.
/// @dev The platform wallet is a constructor input. The authenticated market registry has no admin writer.
contract CarveFactoryV2 is CarveEscrow {
    uint256 public constant supply = 1_000_000_000e18;
    uint256 public constant virtualETH = 1.68 ether;
    uint256 public constant capETH = 4.2 ether;
    uint256 public constant creationFee = 0.0005 ether;
    uint16 public constant platformFeeBps = 100;
    uint16 public constant creatorFeeLimitBps = 1_000;

    CarveContentRegistry public immutable registry;
    address public immutable platformRecipient;
    address public immutable migrationAdapter;
    address public immutable locker;
    address[] public markets;
    mapping(address => address) public marketForToken;
    mapping(address => bool) public isMarket;

    error InvalidDependencies();
    error InvalidLaunch();
    error InvalidContent();
    error InsufficientCreationFee();

    event Launched(address indexed creator, address indexed token, address indexed market,
        bytes32 imageRoot, bytes32 audioRoot, bytes32 websiteRoot, uint16 creatorFeeBps);

    constructor(CarveContentRegistry registry_, address platformRecipient_, address engine_) {
        if (address(registry_).code.length == 0 || platformRecipient_ == address(0)
            || engine_.code.length == 0) revert InvalidDependencies();
        if (ICarveMigrationAdapterV2(engine_).factory() != address(this)
            || ICarveMigrationAdapterV2(engine_).poolManager().code.length == 0) revert InvalidDependencies();
        CarveCurveValidation.validate(supply, virtualETH, capETH);
        CarveFeePolicy.validate(creatorFeeLimitBps, creatorFeeLimitBps);
        registry = registry_;
        platformRecipient = platformRecipient_;
        migrationAdapter = engine_;
        locker = engine_;
    }

    function launch(string calldata name, string calldata symbol, bytes32 imageRoot, bytes32 audioRoot,
        bytes32 websiteRoot, uint16 creatorFeeBps, uint256 minTokensOut, uint256 deadline)
        external payable nonReentrant returns (address token, address market)
    {
        if (bytes(name).length == 0 || bytes(name).length > 64 || bytes(symbol).length == 0 || bytes(symbol).length > 12)
            revert InvalidLaunch();
        CarveFeePolicy.validate(creatorFeeBps, creatorFeeLimitBps);
        if (msg.value < creationFee) revert InsufficientCreationFee();
        if ((imageRoot == 0 && audioRoot == 0 && websiteRoot == 0)
            || (imageRoot != 0 && !registry.exists(imageRoot))
            || (audioRoot != 0 && !registry.exists(audioRoot)) || (websiteRoot != 0 && !registry.exists(websiteRoot)))
            revert InvalidContent();
        _credit(platformRecipient, creationFee);
        CarveMarketV2 deployed = new CarveMarketV2{value: msg.value - creationFee}(
            msg.sender, address(registry), name, symbol, imageRoot, audioRoot, websiteRoot, creatorFeeBps,
            CarveMarketV2.Config(supply, virtualETH, capETH, creatorFeeLimitBps, platformRecipient, migrationAdapter, locker),
            minTokensOut, deadline
        );
        token = address(deployed.token());
        market = address(deployed);
        markets.push(market);
        marketForToken[token] = market;
        isMarket[market] = true;
        // The constructor's initial buy may fill the curve. Register first so the engine can
        // authenticate it, then atomically create and permanently lock its v4 position.
        if (deployed.canGraduate()) deployed.graduate(0, deadline);
        emit Launched(msg.sender, token, market, imageRoot, audioRoot, websiteRoot, creatorFeeBps);
    }

    function marketCount() external view returns (uint256) { return markets.length; }
}
