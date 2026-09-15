// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {CarveFeePolicy} from "../src/CarveFeePolicy.sol";

interface FeePolicyVm {
    function expectRevert(bytes4 selector) external;
}

contract FeePolicyHarness {
    function validate(uint16 creatorBps, uint16 limitBps) external pure returns (uint16) {
        return CarveFeePolicy.validate(creatorBps, limitBps);
    }
    function fromGross(uint256 gross, uint16 creatorBps, uint16 limitBps)
        external pure returns (CarveFeePolicy.Amounts memory)
    {
        return CarveFeePolicy.fromGross(gross, creatorBps, limitBps);
    }
    function grossForNet(uint256 net, uint16 creatorBps, uint16 limitBps) external pure returns (uint256) {
        return CarveFeePolicy.grossForNet(net, creatorBps, limitBps);
    }
    function cappedBuy(uint256 gross, uint256 remaining, uint16 creatorBps, uint16 limitBps)
        external pure returns (CarveFeePolicy.CappedBuy memory)
    {
        return CarveFeePolicy.cappedBuy(gross, remaining, creatorBps, limitBps);
    }
}

contract CarveFeePolicyTest {
    FeePolicyVm private constant vm = FeePolicyVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    FeePolicyHarness private harness;

    function setUp() public { harness = new FeePolicyHarness(); }

    function testSeparatePlatformAndCreatorAmounts() public pure {
        CarveFeePolicy.Amounts memory amounts = CarveFeePolicy.fromGross(1 ether, 200, 500);
        require(amounts.platformFee == 0.01 ether, "Carve gets fixed 1%");
        require(amounts.creatorFee == 0.02 ether, "creator gets additional 2%");
        require(amounts.net == 0.97 ether, "net after both fees");
    }

    function testZeroCreatorFeeAndZeroGross() public pure {
        CarveFeePolicy.Amounts memory amounts = CarveFeePolicy.fromGross(1 ether, 0, 0);
        require(amounts.platformFee == 0.01 ether && amounts.creatorFee == 0, "no share of Carve fee");
        require(amounts.net == 0.99 ether, "net after Carve fee");
        amounts = CarveFeePolicy.fromGross(0, 500, 500);
        require(amounts.net == 0 && amounts.platformFee == 0 && amounts.creatorFee == 0, "zero gross");
    }

    function testBaseUnitRoundingAndNoOvercharge() public pure {
        CarveFeePolicy.Amounts memory amounts = CarveFeePolicy.fromGross(1, 100, 100);
        require(amounts.net == 0 && amounts.platformFee == 1 && amounts.creatorFee == 0, "one unit");
        amounts = CarveFeePolicy.fromGross(50, 100, 100);
        require(amounts.net == 49 && amounts.platformFee == 1 && amounts.creatorFee == 0, "half unit");
        amounts = CarveFeePolicy.fromGross(51, 100, 100);
        require(amounts.net == 49 && amounts.platformFee == 1 && amounts.creatorFee == 1, "aggregate ceil");
        amounts = CarveFeePolicy.fromGross(100, 100, 100);
        require(amounts.net == 98 && amounts.platformFee == 1 && amounts.creatorFee == 1, "whole unit");
        amounts = CarveFeePolicy.fromGross(101, 100, 100);
        require(amounts.net == 98 && amounts.platformFee == 2 && amounts.creatorFee == 1, "Carve ceil");
    }

    function testReviewedLimitAndStructuralBoundary() public pure {
        require(CarveFeePolicy.validate(123, 123) == 223, "creator may choose reviewed limit");
        CarveFeePolicy.Amounts memory amounts = CarveFeePolicy.fromGross(10_000, 9_899, 9_899);
        require(amounts.net == 1 && amounts.platformFee == 100 && amounts.creatorFee == 9_899, "99.99% boundary");
        require(CarveFeePolicy.grossForNet(1, 9_899, 9_899) == 10_000, "last positive net rate");
    }

    function testApprovedReleaseCreatorLimit() public {
        CarveFeePolicy.Amounts memory amounts = CarveFeePolicy.fromGross(1 ether, 1_000, 1_000);
        require(amounts.platformFee == 0.01 ether && amounts.creatorFee == 0.1 ether, "approved separate fees");
        require(amounts.net == 0.89 ether, "approved maximum creator fee net");
        vm.expectRevert(CarveFeePolicy.CreatorFeeAboveLimit.selector); harness.validate(1_001, 1_000);
    }

    function testInvalidCreatorFeesAndLimitsRevert() public {
        vm.expectRevert(CarveFeePolicy.CreatorFeeAboveLimit.selector); harness.validate(501, 500);
        vm.expectRevert(CarveFeePolicy.CreatorFeeAboveLimit.selector); harness.validate(1, 0);
        vm.expectRevert(CarveFeePolicy.CreatorFeeAboveLimit.selector); harness.validate(type(uint16).max, 9_899);
        vm.expectRevert(CarveFeePolicy.InvalidCreatorFeeLimit.selector); harness.validate(0, 9_900);
        vm.expectRevert(CarveFeePolicy.InvalidCreatorFeeLimit.selector); harness.validate(0, type(uint16).max);
        vm.expectRevert(CarveFeePolicy.CreatorFeeAboveLimit.selector); harness.fromGross(0, 1, 0);
        vm.expectRevert(CarveFeePolicy.CreatorFeeAboveLimit.selector); harness.grossForNet(0, 1, 0);
        vm.expectRevert(CarveFeePolicy.CreatorFeeAboveLimit.selector); harness.cappedBuy(0, 0, 1, 0);
    }

    function testGrossForNetKnownValuesAndZero() public pure {
        require(CarveFeePolicy.grossForNet(0, 200, 500) == 0, "zero net");
        require(CarveFeePolicy.grossForNet(1, 0, 0) == 2, "smallest useful Carve-only gross");
        require(CarveFeePolicy.grossForNet(0.97 ether, 200, 500) == 1 ether, "exact percentage inverse");
        require(CarveFeePolicy.grossForNet(1 ether, 200, 500) == 1_030_927_835_051_546_392, "ceil inverse");
    }

    function testCappedBuyExactReserveAndRefund() public pure {
        CarveFeePolicy.CappedBuy memory quote = CarveFeePolicy.cappedBuy(3 ether, 1 ether, 200, 500);
        require(quote.acceptedGross == 1_030_927_835_051_546_392 && quote.net == 1 ether, "cap exact");
        require(quote.platformFee == 10_309_278_350_515_464, "Carve on accepted gross");
        require(quote.creatorFee == 20_618_556_701_030_928, "creator on accepted gross");
        require(quote.refund == 1_969_072_164_948_453_608, "all excess refunded");
    }

    function testCappedBuyRefundsRoundingPlateau() public pure {
        // Both 50 and 51 gross produce 49 net; only 50 is needed to finish this cap.
        CarveFeePolicy.CappedBuy memory quote = CarveFeePolicy.cappedBuy(51, 49, 100, 100);
        require(quote.acceptedGross == 50 && quote.net == 49 && quote.refund == 1, "minimal cap input");
        require(quote.platformFee == 1 && quote.creatorFee == 0, "no fees on refunded excess");
    }

    function testCappedBuyBelowCapReachedCapAndZeroOffer() public pure {
        CarveFeePolicy.CappedBuy memory quote = CarveFeePolicy.cappedBuy(1 ether, 2 ether, 200, 500);
        require(quote.acceptedGross == 1 ether && quote.net == 0.97 ether && quote.refund == 0, "below cap");
        quote = CarveFeePolicy.cappedBuy(1 ether, 0, 200, 500);
        require(quote.acceptedGross == 0 && quote.net == 0 && quote.refund == 1 ether, "reached cap");
        require(quote.platformFee == 0 && quote.creatorFee == 0, "no cap fee");
        quote = CarveFeePolicy.cappedBuy(0, 1 ether, 200, 500);
        require(quote.acceptedGross == 0 && quote.net == 0 && quote.refund == 0, "zero offer");
        require(quote.platformFee == 0 && quote.creatorFee == 0, "no zero-offer fee");
    }

    function testUint256MaximumAndUnreachableCap() public pure {
        uint256 maximum = type(uint256).max;
        CarveFeePolicy.Amounts memory amounts = CarveFeePolicy.fromGross(maximum, 9_899, 9_899);
        require(amounts.net == maximum / 10_000, "maximum gross safe");
        require(amounts.platformFee + amounts.creatorFee == maximum - amounts.net, "maximum conservation");
        require(CarveFeePolicy.grossForNet(amounts.net, 9_899, 9_899) <= maximum, "inverse fits");
        CarveFeePolicy.CappedBuy memory quote = CarveFeePolicy.cappedBuy(maximum, maximum, 9_899, 9_899);
        require(quote.acceptedGross == maximum && quote.net == amounts.net && quote.refund == 0, "unreachable cap is not overflow");
    }

    function testUnrepresentableGrossReverts() public {
        vm.expectRevert(CarveFeePolicy.GrossAmountOverflow.selector);
        harness.grossForNet(type(uint256).max, 0, 0);
        uint256 maxNet = CarveFeePolicy.fromGross(type(uint256).max, 200, 200).net;
        require(CarveFeePolicy.fromGross(CarveFeePolicy.grossForNet(maxNet, 200, 200), 200, 200).net == maxNet, "largest net fits");
        vm.expectRevert(CarveFeePolicy.GrossAmountOverflow.selector);
        harness.grossForNet(maxNet + 1, 200, 200);
    }

    function testSmallDomainNetIsMonotonicAcrossFeeBoundaries() public pure {
        uint16[7] memory rates = [uint16(0), 1, 99, 100, 101, 500, 9_899];
        for (uint256 i; i < rates.length; ++i) {
            uint256 previousNet;
            for (uint256 gross; gross <= 250; ++gross) {
                CarveFeePolicy.Amounts memory amounts = CarveFeePolicy.fromGross(gross, rates[i], rates[i]);
                require(amounts.net >= previousNet && amounts.net <= previousNet + 1, "net step");
                require(amounts.net + amounts.platformFee + amounts.creatorFee == gross, "conservation");
                previousNet = amounts.net;
            }
        }
    }

    function testFuzzIndependentReference(uint128 gross, uint16 creatorSeed, uint16 limitSeed) public pure {
        uint16 limitBps = limitSeed % 9_900;
        uint16 creatorBps = creatorSeed % (limitBps + 1);
        CarveFeePolicy.Amounts memory amounts = CarveFeePolicy.fromGross(gross, creatorBps, limitBps);
        // Direct rational arithmetic is safe for uint128 inputs and independent of implementation decomposition.
        uint256 platformNumerator = uint256(gross) * 100;
        uint256 creatorNumerator = uint256(gross) * creatorBps;
        uint256 totalNumerator = platformNumerator + creatorNumerator;
        require(amounts.platformFee == (platformNumerator + 9_999) / 10_000, "reference Carve amount");
        require(amounts.net == uint256(gross) - (totalNumerator + 9_999) / 10_000, "reference net");
        require(amounts.creatorFee >= creatorNumerator / 10_000, "creator rounding lower bound");
        require(amounts.creatorFee <= (creatorNumerator + 9_999) / 10_000, "creator rounding upper bound");
        require(amounts.net + amounts.platformFee + amounts.creatorFee == gross, "reference conservation");
    }

    function testFuzzFullWidthConservationAndCarveIndependence(uint256 gross, uint16 creatorSeed) public pure {
        uint16 creatorBps = creatorSeed % 9_900;
        CarveFeePolicy.Amounts memory amounts = CarveFeePolicy.fromGross(gross, creatorBps, 9_899);
        CarveFeePolicy.Amounts memory noCreator = CarveFeePolicy.fromGross(gross, 0, 0);
        require(amounts.platformFee == noCreator.platformFee && noCreator.creatorFee == 0, "fixed Carve fee independent of creator");
        require(amounts.net <= noCreator.net, "creator fee cannot raise output");
        require(amounts.net + amounts.platformFee + amounts.creatorFee == gross, "full width conservation");
        if (gross != type(uint256).max) {
            uint256 nextNet = CarveFeePolicy.fromGross(gross + 1, creatorBps, 9_899).net;
            require(nextNet >= amounts.net && nextNet <= amounts.net + 1, "full width monotonic step");
        }
    }

    function testFuzzFullWidthInverseIsExactAndMinimal(uint256 gross, uint16 creatorSeed) public pure {
        uint16 creatorBps = creatorSeed % 9_900;
        uint256 desiredNet = CarveFeePolicy.fromGross(gross, creatorBps, 9_899).net;
        uint256 minimalGross = CarveFeePolicy.grossForNet(desiredNet, creatorBps, 9_899);
        require(minimalGross <= gross, "inverse cannot exceed known sufficient gross");
        require(CarveFeePolicy.fromGross(minimalGross, creatorBps, 9_899).net == desiredNet, "inverse exact");
        if (desiredNet > 0) {
            require(CarveFeePolicy.fromGross(minimalGross - 1, creatorBps, 9_899).net == desiredNet - 1, "inverse minimal");
        } else require(minimalGross == 0, "zero net needs no gross");
    }

    function testFuzzFullWidthCappedBuy(uint256 gross, uint256 remaining, uint16 creatorSeed) public pure {
        uint16 creatorBps = creatorSeed % 9_900;
        CarveFeePolicy.CappedBuy memory quote = CarveFeePolicy.cappedBuy(gross, remaining, creatorBps, 9_899);
        CarveFeePolicy.Amounts memory full = CarveFeePolicy.fromGross(gross, creatorBps, 9_899);
        require(quote.net == (full.net < remaining ? full.net : remaining), "net uses exact available capacity");
        require(quote.net + quote.platformFee + quote.creatorFee == quote.acceptedGross, "accepted conservation");
        require(quote.acceptedGross + quote.refund == gross, "offer conservation");
        CarveFeePolicy.Amounts memory accepted = CarveFeePolicy.fromGross(quote.acceptedGross, creatorBps, 9_899);
        require(quote.platformFee == accepted.platformFee && quote.creatorFee == accepted.creatorFee, "fees exclude refund");
        if (remaining > 0 && full.net >= remaining) {
            require(CarveFeePolicy.fromGross(quote.acceptedGross - 1, creatorBps, 9_899).net < remaining, "capped input minimal");
        }
    }
}
