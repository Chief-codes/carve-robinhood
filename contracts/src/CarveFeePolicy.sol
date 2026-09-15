// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// @notice Pure fee arithmetic for a fixed 1% Carve fee plus a separate per-token creator fee.
/// @dev Not yet wired into CarveMarket, CarveFactory or a v4 hook. Amounts use the same asset/base unit.
///      Carve receives ceil(gross * 100 / 10000). Aggregate fees round up once; the creator receives
///      the remainder. Net output is monotonic, creator fees are zero at 0 bps, and fees never exceed gross.
library CarveFeePolicy {
    uint16 internal constant BPS = 10_000;
    uint16 internal constant PLATFORM_FEE_BPS = 100;

    struct Amounts {
        uint256 net;
        uint256 platformFee;
        uint256 creatorFee;
    }

    struct CappedBuy {
        uint256 acceptedGross;
        uint256 net;
        uint256 platformFee;
        uint256 creatorFee;
        uint256 refund;
    }

    error InvalidCreatorFeeLimit();
    error CreatorFeeAboveLimit();
    error GrossAmountOverflow();

    /// @notice The caller must supply the reviewed creator-fee ceiling; there is no deployment default.
    /// @dev A total below 100% is an arithmetic requirement for positive net output and its inverse,
    ///      not a recommended product ceiling. A reviewed limit of zero permits only the 1% Carve fee.
    function validate(uint16 creatorFeeBps, uint16 reviewedCreatorFeeLimitBps)
        internal pure returns (uint16 totalFeeBps)
    {
        if (reviewedCreatorFeeLimitBps >= BPS - PLATFORM_FEE_BPS) revert InvalidCreatorFeeLimit();
        if (creatorFeeBps > reviewedCreatorFeeLimitBps) revert CreatorFeeAboveLimit();
        return PLATFORM_FEE_BPS + creatorFeeBps;
    }

    /// @notice Returns the net amount and two separately creditable fee amounts.
    /// @dev net = floor(gross * (10000 - totalFeeBps) / 10000).
    ///      platformFee = ceil(gross / 100).
    ///      creatorFee = gross - net - platformFee, within one base unit of gross * creatorBps / 10000.
    ///      Tiny gross amounts may produce zero net; execution must reject zero-output trades.
    function fromGross(uint256 gross, uint16 creatorFeeBps, uint16 reviewedCreatorFeeLimitBps)
        internal pure returns (Amounts memory amounts)
    {
        uint256 netBps = BPS - validate(creatorFeeBps, reviewedCreatorFeeLimitBps);
        // Decompose first: gross * netBps may overflow, although its divided result cannot.
        amounts.net = (gross / BPS) * netBps + (gross % BPS) * netBps / BPS;
        amounts.platformFee = gross / 100 + (gross % 100 == 0 ? 0 : 1);
        // ceil(gross * totalFeeBps / BPS) >= ceil(gross * PLATFORM_FEE_BPS / BPS).
        amounts.creatorFee = gross - amounts.net - amounts.platformFee;
    }

    /// @notice Smallest gross amount giving exactly desiredNet under fromGross's rounding.
    /// @dev ceil(desiredNet * 10000 / netBps), computed without an overflowing intermediate.
    ///      fromGross(gross).net == desiredNet, and for desiredNet > 0 the preceding gross gives
    ///      desiredNet - 1. Reverts only for invalid fee configuration or an unrepresentable gross.
    function grossForNet(uint256 desiredNet, uint16 creatorFeeBps, uint16 reviewedCreatorFeeLimitBps)
        internal pure returns (uint256 gross)
    {
        uint256 netBps = BPS - validate(creatorFeeBps, reviewedCreatorFeeLimitBps);
        uint256 quotient = desiredNet / netBps;
        if (quotient > type(uint256).max / BPS) revert GrossAmountOverflow();
        gross = quotient * BPS;
        uint256 remainder = desiredNet % netBps;
        uint256 tail = (remainder * BPS + netBps - 1) / netBps;
        if (tail > type(uint256).max - gross) revert GrossAmountOverflow();
        gross += tail;
    }

    /// @notice Caps net reserve input and returns all excess gross as a separate refund.
    /// @dev Fees apply only to acceptedGross. At a reached cap nothing is accepted or charged.
    ///      Even if the full offer gives exactly remainingNet, refund its rounding-plateau excess.
    ///      A remainingNet too large to fill does not cause inverse overflow: quote the offer first.
    function cappedBuy(uint256 offeredGross, uint256 remainingNet, uint16 creatorFeeBps,
        uint16 reviewedCreatorFeeLimitBps) internal pure returns (CappedBuy memory quote)
    {
        Amounts memory amounts = fromGross(offeredGross, creatorFeeBps, reviewedCreatorFeeLimitBps);
        if (remainingNet == 0) {
            quote.refund = offeredGross;
            return quote;
        }
        quote.acceptedGross = offeredGross;
        if (amounts.net >= remainingNet) {
            quote.acceptedGross = grossForNet(remainingNet, creatorFeeBps, reviewedCreatorFeeLimitBps);
            amounts = fromGross(quote.acceptedGross, creatorFeeBps, reviewedCreatorFeeLimitBps);
        }
        quote.net = amounts.net;
        quote.platformFee = amounts.platformFee;
        quote.creatorFee = amounts.creatorFee;
        quote.refund = offeredGross - quote.acceptedGross;
    }
}
