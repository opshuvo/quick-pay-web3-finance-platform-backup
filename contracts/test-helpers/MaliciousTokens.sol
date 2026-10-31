// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IRouterLike {
    function payTo(address recipient, uint256 amount, bytes32 reference_) external;
}

/// @dev Token whose transferFrom tries to re-enter the router's payTo.
contract ReentrantToken {
    IRouterLike public router;
    address public reenterRecipient;
    bool public swallow; // if true, catch the reentrant revert instead of bubbling
    bool public reentered; // reentrant call attempted
    bool public reentrySucceeded;
    bytes public lastRevertData;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function configure(address router_, address recipient_, bool swallow_) external {
        router = IRouterLike(router_);
        reenterRecipient = recipient_;
        swallow = swallow_;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        reentered = true;
        if (swallow) {
            try router.payTo(reenterRecipient, 1, bytes32(uint256(0xdead))) {
                reentrySucceeded = true;
            } catch (bytes memory data) {
                lastRevertData = data;
            }
        } else {
            router.payTo(reenterRecipient, 1, bytes32(uint256(0xdead)));
            reentrySucceeded = true;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @dev Token whose transferFrom returns false without moving funds.
contract FalseReturnToken {
    function transferFrom(address, address, uint256) external pure returns (bool) {
        return false;
    }
}

/// @dev Token whose transferFrom returns no data (USDT-style) and moves funds.
contract NoReturnToken {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transferFrom(address from, address to, uint256 amount) external {
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}
