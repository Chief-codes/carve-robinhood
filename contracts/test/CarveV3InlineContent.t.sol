// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {CarveContentRegistry} from "../src/CarveContentRegistry.sol";
import {CarveInlineContent} from "../src/v3/CarveInlineContent.sol";

interface VmInline {
    function expectRevert(bytes4 selector) external;
}

contract InlineContentHarness {
    function prepare(CarveContentRegistry registry, CarveInlineContent.Asset[3] calldata assets)
        external returns (bytes32[3] memory)
    { return CarveInlineContent.prepare(registry, assets); }
    function prepareThenRevert(CarveContentRegistry registry, CarveInlineContent.Asset[3] calldata assets) external {
        CarveInlineContent.prepare(registry, assets);
        revert("launch failed");
    }
}

contract CarveV3InlineContentTest {
    VmInline constant vm = VmInline(address(uint160(uint256(keccak256("hevm cheat code")))));
    CarveContentRegistry registry;
    InlineContentHarness harness;
    function setUp() public { registry = new CarveContentRegistry(); harness = new InlineContentHarness(); }
    function _assets() private pure returns (CarveInlineContent.Asset[3] memory assets) {
        assets[0] = CarveInlineContent.Asset(0, "image/png", "identity", hex"89504e470d0a1a0a");
        assets[1] = CarveInlineContent.Asset(0, "audio/wav", "identity", hex"524946460000000057415645");
        assets[2] = CarveInlineContent.Asset(0, "text/html", "identity", bytes("<!doctype html><h1>Carve</h1>"));
    }
    function testAllThreeInlineAssetsReadBackExactBytesAndFactoryRegistrant() public {
        CarveInlineContent.Asset[3] memory assets = _assets();
        bytes32[3] memory roots = harness.prepare(registry, assets);
        for (uint256 i; i < 3; ++i) {
            require(keccak256(registry.read(roots[i])) == keccak256(assets[i].data), "bytes mismatch");
            (,,,,address registrant,,) = registry.getContent(roots[i]);
            require(registrant == address(harness), "wrong registrant");
        }
    }
    function testAllSevenCombinations() public {
        for (uint256 mask = 1; mask < 8; ++mask) {
            CarveInlineContent.Asset[3] memory assets = _assets();
            for (uint256 i; i < 3; ++i) if (mask & (1 << i) == 0) delete assets[i];
            bytes32[3] memory roots = harness.prepare(registry, assets);
            for (uint256 i; i < 3; ++i) require((roots[i] != 0) == (mask & (1 << i) != 0), "combination");
        }
    }
    function testExistingRootsAndMixedInlineFiles() public {
        CarveInlineContent.Asset[3] memory assets = _assets();
        bytes32[3] memory old = harness.prepare(registry, assets);
        assets[0] = CarveInlineContent.Asset(old[0], "", "", "");
        assets[1].data = bytes("new audio");
        bytes32[3] memory next = harness.prepare(registry, assets);
        require(next[0] == old[0] && next[1] != old[1] && next[2] == old[2], "reuse");
    }
    function testDeduplicatedInlineContentDoesNotRevert() public {
        CarveInlineContent.Asset[3] memory assets = _assets();
        bytes32[3] memory a = harness.prepare(registry, assets);
        bytes32[3] memory b = harness.prepare(registry, assets);
        require(keccak256(abi.encode(a)) == keccak256(abi.encode(b)), "dedup");
    }
    function testMaxSizeUsesMultipleOrderedChunks() public {
        CarveInlineContent.Asset[3] memory assets;
        bytes memory data = new bytes(24_576);
        data[20_479] = 0xab; data[20_480] = 0xcd; data[24_575] = 0xef;
        assets[2] = CarveInlineContent.Asset(0, "text/html", "identity", data);
        bytes32[3] memory roots = harness.prepare(registry, assets);
        (,,,uint256 length,,address[] memory pointers,bytes32[] memory hashes) = registry.getContent(roots[2]);
        require(length == 24_576 && pointers.length == 2 && hashes.length == 2, "chunks");
        require(keccak256(registry.read(roots[2])) == keccak256(data), "order");
    }
    function testCombinedSizeLimitNotPerAsset() public {
        CarveInlineContent.Asset[3] memory assets = _assets();
        assets[0].data = new bytes(12_288); assets[1].data = new bytes(12_288);
        vm.expectRevert(CarveInlineContent.InlineContentTooLarge.selector); harness.prepare(registry, assets);
    }
    function testUnknownRootRejected() public {
        CarveInlineContent.Asset[3] memory assets;
        assets[0].root = bytes32(uint256(123));
        vm.expectRevert(CarveInlineContent.InvalidContentRoot.selector); harness.prepare(registry, assets);
    }
    function testAmbiguousRootAndInlineRejected() public {
        CarveInlineContent.Asset[3] memory assets = _assets(); assets[0].root = bytes32(uint256(1));
        vm.expectRevert(CarveInlineContent.InvalidInlineAsset.selector); harness.prepare(registry, assets);
    }
    function testEmptySlotWithMimeRejected() public {
        CarveInlineContent.Asset[3] memory assets; assets[2].mimeType = "text/html";
        vm.expectRevert(CarveInlineContent.InvalidInlineAsset.selector); harness.prepare(registry, assets);
    }
    function testUnknownEncodingRejected() public {
        CarveInlineContent.Asset[3] memory assets = _assets(); assets[2].encoding = "brotli";
        vm.expectRevert(CarveInlineContent.InvalidInlineAsset.selector); harness.prepare(registry, assets);
    }
    function testLaterLaunchFailureRollsBackContentWrites() public {
        CarveInlineContent.Asset[3] memory assets = _assets();
        (bool success,) = address(harness).call(abi.encodeCall(harness.prepareThenRevert, (registry, assets)));
        require(!success, "must revert");
        require(registry.pointerForHash(keccak256(assets[0].data)) == address(0), "orphan write");
    }
    function testFuzzBinaryBytesPreserved(bytes calldata input) public {
        if (input.length == 0 || input.length > 24_576) return;
        CarveInlineContent.Asset[3] memory assets;
        assets[1] = CarveInlineContent.Asset(0, "audio/ogg", "identity", input);
        bytes32[3] memory roots = harness.prepare(registry, assets);
        require(keccak256(registry.read(roots[1])) == keccak256(input), "binary changed");
    }
}
