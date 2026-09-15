// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

abstract contract CarveEscrow {
    mapping(address => uint256) public pendingETH;
    uint256 public totalPendingETH;
    uint256 private guard = 1;
    error ReentrantCall();
    error NoCredit();
    error InvalidRecipient();
    error ETHTransferFailed();
    event ETHWithdrawn(address indexed account, address indexed recipient, uint256 amount);

    modifier nonReentrant() {
        if (guard != 1) revert ReentrantCall();
        guard = 2;
        _;
        guard = 1;
    }

    function _credit(address account, uint256 amount) internal {
        pendingETH[account] += amount;
        totalPendingETH += amount;
    }

    /// @notice A rejecting contract can withdraw its credit to another recipient.
    function withdrawETH(address payable to) external nonReentrant {
        if (to == address(0)) revert InvalidRecipient();
        uint256 amount = pendingETH[msg.sender];
        if (amount == 0) revert NoCredit();
        pendingETH[msg.sender] = 0;
        totalPendingETH -= amount;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert ETHTransferFailed();
        emit ETHWithdrawn(msg.sender, to, amount);
    }
}
