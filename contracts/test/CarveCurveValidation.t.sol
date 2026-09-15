// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {CarveCurveValidation} from "../src/CarveCurveValidation.sol";

interface CurveValidationVm {
    function expectRevert(bytes4 selector) external;
}

contract CurveValidationHarness {
    function validate(uint256 supply, uint256 virtualETH, uint256 capETH) external pure returns (uint256) {
        return CarveCurveValidation.validate(supply, virtualETH, capETH);
    }
}

contract CarveCurveValidationTest {
    CurveValidationVm private constant vm = CurveValidationVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    CurveValidationHarness private harness;

    function setUp() public { harness = new CurveValidationHarness(); }

    function testPrototypeAndMaximumScalarValuesPass() public pure {
        require(CarveCurveValidation.validate(1_000_000_000e18, 10 ether, 20 ether) > 0, "prototype curve");
        require(CarveCurveValidation.validate(1e36, 1e30, 1e30) == 5e35, "maximum scalar values");
    }

    function testApprovedReleaseCurvePasses() public pure {
        uint256 expected = uint256(1_000_000_000e18) * 5 / 7;
        require(CarveCurveValidation.validate(1_000_000_000e18, 1.68 ether, 4.2 ether) == expected, "approved curve");
    }

    function testPreviouslyAcceptedZeroOutputExampleRejected() public {
        vm.expectRevert(CarveCurveValidation.ZeroInitialBuyCapacity.selector);
        harness.validate(1e18, 1e30, 1);
    }

    function testExactFirstTokenUnitBoundary() public {
        vm.expectRevert(CarveCurveValidation.ZeroInitialBuyCapacity.selector);
        harness.validate(1e18, 1e30, 1e12);
        require(CarveCurveValidation.validate(1e18, 1e30, 1e12 + 1) == 1, "first token base unit");
    }

    function testScalarBoundsRejectedBeforeMultiplication() public {
        vm.expectRevert(CarveCurveValidation.InvalidCurveBounds.selector); harness.validate(1e18 - 1, 1, 1);
        vm.expectRevert(CarveCurveValidation.InvalidCurveBounds.selector); harness.validate(1e36 + 1, 1, 1);
        vm.expectRevert(CarveCurveValidation.InvalidCurveBounds.selector); harness.validate(1e18, 0, 1);
        vm.expectRevert(CarveCurveValidation.InvalidCurveBounds.selector); harness.validate(1e18, 1e30 + 1, 1);
        vm.expectRevert(CarveCurveValidation.InvalidCurveBounds.selector); harness.validate(1e18, 1, 0);
        vm.expectRevert(CarveCurveValidation.InvalidCurveBounds.selector); harness.validate(1e18, 1, 1e30 + 1);
        vm.expectRevert(CarveCurveValidation.InvalidCurveBounds.selector);
        harness.validate(type(uint256).max, type(uint256).max, type(uint256).max);
    }

    function testFuzzFirstTokenBoundary(uint128 supplySeed, uint128 virtualSeed) public {
        uint256 supply = uint256(supplySeed) % (1e36 - 1e18 + 1) + 1e18;
        uint256 virtualETH = uint256(virtualSeed) % 1e30 + 1;
        // Independent inequality for one token base unit: (supply - 1) * capETH >= virtualETH.
        uint256 minimumCap = (virtualETH - 1) / (supply - 1) + 1;
        require(CarveCurveValidation.validate(supply, virtualETH, minimumCap) > 0, "minimum cap produces output");
        if (minimumCap > 1) {
            vm.expectRevert(CarveCurveValidation.ZeroInitialBuyCapacity.selector);
            harness.validate(supply, virtualETH, minimumCap - 1);
        }
    }
}
