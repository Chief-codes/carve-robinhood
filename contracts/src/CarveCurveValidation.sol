// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// @notice Additive launch checks for the current curve formula; not yet wired into a factory.
/// @dev Reuses the prototype's scalar arithmetic bounds. Passing does not prove every trade is useful,
///      every rounding path can fill the cap, or any terminal state can seed a v4 position.
library CarveCurveValidation {
    error InvalidCurveBounds();
    error ZeroInitialBuyCapacity();

    /// @notice Reject a curve whose largest possible initial buy still returns zero token base units.
    /// @dev capETH is net reserve input after fees. This necessary check makes no new fee/price policy.
    function validate(uint256 supply, uint256 virtualETH, uint256 capETH)
        internal pure returns (uint256 maximumInitialTokensOut)
    {
        if (supply < 1e18 || supply > 1e36 || virtualETH == 0 || virtualETH > 1e30
            || capETH == 0 || capETH > 1e30) revert InvalidCurveBounds();
        // Existing scalar bounds keep this product <= 1e66 and denominator <= 2e30.
        maximumInitialTokensOut = supply * capETH / (virtualETH + capETH);
        if (maximumInitialTokensOut == 0) revert ZeroInitialBuyCapacity();
    }
}
