// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {CarveContentRegistry} from "../CarveContentRegistry.sol";
import {CarveCurveFactory} from "./CarveCurveFactory.sol";
import {CarveCurveEngine} from "./CarveCurveEngine.sol";
import {CarveCurveRouter} from "./CarveCurveRouter.sol";

/// @notice Atomically wires the immutable engine, factory and separate trade router.
/// @dev Salt is mined OFFCHAIN for this coordinator address and verified by engine construction.
///      No wallet key, owner, setter, fee-change, or post-deployment administrative action.
contract CarveCurveDeployment {
    address public constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    bytes32 public constant POOL_MANAGER_CODE_HASH =
        0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626;
    CarveContentRegistry public immutable registry;
    CarveCurveEngine public immutable engine;
    CarveCurveFactory public immutable factory;
    CarveCurveRouter public immutable router;
    event Installed(address registry, address engine, address factory, address router, address platformRecipient);
    error WrongChainOrDependency();

    constructor(CarveContentRegistry registry_, address platformRecipient, bytes32 hookSalt) {
        if (block.chainid != 4663 || POOL_MANAGER.codehash != POOL_MANAGER_CODE_HASH
            || address(registry_).code.length == 0 || platformRecipient == address(0)) revert WrongChainOrDependency();
        // A new contract starts at nonce1. CREATE2(engine) consumes nonce1; CREATE(factory) uses nonce2.
        address futureFactory = address(uint160(uint256(keccak256(abi.encodePacked(hex"d694", address(this), hex"02")))));
        registry = registry_;
        engine = new CarveCurveEngine{salt: hookSalt}(POOL_MANAGER, futureFactory);
        factory = new CarveCurveFactory(registry_, platformRecipient, address(engine));
        if (address(factory) != futureFactory || engine.factory() != address(factory)
            || factory.migrationAdapter() != address(engine)) revert WrongChainOrDependency();
        router = new CarveCurveRouter(engine);
        emit Installed(address(registry_), address(engine), address(factory), address(router), platformRecipient);
    }
}

