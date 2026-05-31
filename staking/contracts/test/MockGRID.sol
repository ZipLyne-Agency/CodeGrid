// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Minimal 18-decimal ERC-20 standing in for $GRID in tests.
contract MockGRID is ERC20 {
    constructor() ERC20("Mock GRID", "GRID") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
