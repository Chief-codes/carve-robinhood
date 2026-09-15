// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {CarveContentRegistry} from "./CarveContentRegistry.sol";
import {CarveFactoryV2} from "./CarveFactoryV2.sol";
import {CarveV4Engine} from "./CarveV4Engine.sol";
import {CarveV4Router} from "./CarveV4Router.sol";

/// @notice Atomically wires the immutable engine, factory and separate trade router.
/// @dev Salt is mined OFFCHAIN for this coordinator address and verified by engine construction.
///      No wallet key, owner, setter, fee-change, or post-deployment administrative action.
contract CarveDeployment {
    address public constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    bytes32 public constant POOL_MANAGER_CODE_HASH =
        0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626;
    CarveContentRegistry public immutable registry;
    CarveV4Engine public immutable engine;
    CarveFactoryV2 public immutable factory;
    CarveV4Router public immutable router;
    event Installed(address registry, address engine, address factory, address router, address platformRecipient);
    error WrongChainOrDependency();

    constructor(CarveContentRegistry registry_, address platformRecipient, bytes32 hookSalt) {
        if (block.chainid != 4663 || POOL_MANAGER.codehash != POOL_MANAGER_CODE_HASH
            || address(registry_).code.length == 0 || platformRecipient == address(0)) revert WrongChainOrDependency();
        // A new contract starts at nonce1. CREATE2(engine) consumes nonce1; CREATE(factory) uses nonce2.
        address futureFactory = address(uint160(uint256(keccak256(abi.encodePacked(hex"d694", address(this), hex"02")))));
        registry = registry_;
        engine = new CarveV4Engine{salt: hookSalt}(POOL_MANAGER, futureFactory);
        factory = new CarveFactoryV2(registry_, platformRecipient, address(engine));
        if (address(factory) != futureFactory || engine.factory() != address(factory)
            || factory.migrationAdapter() != address(engine)) revert WrongChainOrDependency();
        router = new CarveV4Router(engine);
        emit Installed(address(registry_), address(engine), address(factory), address(router), platformRecipient);
    }
}
