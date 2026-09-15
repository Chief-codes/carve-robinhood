// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// @notice Fixed supply ERC20 with permanent creator and onchain content commitments.
/// @dev No owner, mint, tax, pause, blacklist, proxy or upgrade function.
contract CarveToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public immutable totalSupply;
    address public immutable creator;
    address public immutable contentRegistry;
    bytes32 public immutable imageRoot;
    bytes32 public immutable audioRoot;
    bytes32 public immutable websiteRoot;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    error InvalidAddress();
    error InsufficientBalance();
    error InsufficientAllowance();
    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    constructor(string memory name_, string memory symbol_, uint256 supply_, address creator_,
        address registry_, bytes32 image_, bytes32 audio_, bytes32 website_, address recipient_)
    {
        if (recipient_ == address(0) || creator_ == address(0) || registry_ == address(0)) revert InvalidAddress();
        name = name_; symbol = symbol_; totalSupply = supply_; creator = creator_; contentRegistry = registry_;
        imageRoot = image_; audioRoot = audio_; websiteRoot = website_;
        balanceOf[recipient_] = supply_;
        emit Transfer(address(0), recipient_, supply_);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) { _transfer(msg.sender, to, amount); return true; }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert InsufficientAllowance();
            allowance[from][msg.sender] = allowed - amount;
            emit Approval(from, msg.sender, allowed - amount);
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) private {
        if (to == address(0)) revert InvalidAddress();
        uint256 balance = balanceOf[from];
        if (balance < amount) revert InsufficientBalance();
        balanceOf[from] = balance - amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
