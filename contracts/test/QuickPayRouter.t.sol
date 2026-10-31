// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {QuickPayRouter} from "../QuickPayRouter.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";
import {ReentrantToken, FalseReturnToken, NoReturnToken} from "../test-helpers/MaliciousTokens.sol";

contract QuickPayRouterTest is Test {
    event PaymentSent(address indexed payer, address indexed recipient, uint256 amount, bytes32 indexed reference_);

    QuickPayRouter internal router;
    MockERC20 internal usdc;

    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    uint256 internal constant FUNDS = 1_000e6;
    bytes32 internal constant REF = keccak256("invoice-1");

    function setUp() public {
        usdc = new MockERC20("Mock USDC", "mUSDC", 6);
        router = new QuickPayRouter(address(usdc), owner);
        usdc.mint(alice, FUNDS);
        vm.prank(alice);
        usdc.approve(address(router), type(uint256).max);
    }

    // ---------------------------------------------------------------- deploy

    function test_Constructor_SetsUsdcAndOwner() public view {
        assertEq(address(router.usdc()), address(usdc));
        assertEq(router.owner(), owner);
        assertEq(router.pendingOwner(), address(0));
        assertFalse(router.paused());
    }

    function test_Constructor_RevertsOnZeroUsdc() public {
        vm.expectRevert(QuickPayRouter.ZeroAddress.selector);
        new QuickPayRouter(address(0), owner);
    }

    function test_Constructor_RevertsOnZeroOwner() public {
        // Ownable's constructor runs first and rejects the zero owner.
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new QuickPayRouter(address(usdc), address(0));
    }

    function test_Constructor_RevertsWhenTokenHasNoCode() public {
        vm.expectRevert(abi.encodeWithSelector(QuickPayRouter.TokenHasNoCode.selector, bob));
        new QuickPayRouter(bob, owner);
    }

    // ------------------------------------------------------------- payTo happy

    function test_PayTo_MovesFundsDirectly() public {
        vm.prank(alice);
        router.payTo(bob, 250e6, REF);
        assertEq(usdc.balanceOf(alice), FUNDS - 250e6);
        assertEq(usdc.balanceOf(bob), 250e6);
        assertEq(usdc.balanceOf(address(router)), 0);
    }

    function test_PayTo_EmitsPaymentSent() public {
        vm.expectEmit(true, true, true, true, address(router));
        emit PaymentSent(alice, bob, 42e6, REF);
        vm.prank(alice);
        router.payTo(bob, 42e6, REF);
    }

    function test_PayTo_AllowsZeroAndRepeatedReference() public {
        vm.startPrank(alice);
        vm.expectEmit(true, true, true, true, address(router));
        emit PaymentSent(alice, bob, 1, bytes32(0));
        router.payTo(bob, 1, bytes32(0));
        router.payTo(bob, 1, REF);
        router.payTo(carol, 1, REF);
        vm.stopPrank();
        assertEq(usdc.balanceOf(bob), 2);
        assertEq(usdc.balanceOf(carol), 1);
    }

    function test_PayTo_ConsumesExactAllowance() public {
        vm.startPrank(alice);
        usdc.approve(address(router), 100e6);
        router.payTo(bob, 60e6, REF);
        vm.stopPrank();
        assertEq(usdc.allowance(alice, address(router)), 40e6);
    }

    function test_PayTo_WorksWithNoReturnToken() public {
        NoReturnToken t = new NoReturnToken();
        QuickPayRouter r = new QuickPayRouter(address(t), owner);
        t.mint(alice, 10);
        vm.prank(alice);
        r.payTo(bob, 10, REF);
        assertEq(t.balanceOf(bob), 10);
    }

    // ------------------------------------------------------------- payTo reverts

    function test_PayTo_RevertsOnZeroRecipient() public {
        vm.prank(alice);
        vm.expectRevert(QuickPayRouter.ZeroAddress.selector);
        router.payTo(address(0), 1, REF);
    }

    function test_PayTo_RevertsOnZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(QuickPayRouter.ZeroAmount.selector);
        router.payTo(bob, 0, REF);
    }

    function test_PayTo_RevertsOnSelfPayment() public {
        vm.prank(alice);
        vm.expectRevert(QuickPayRouter.SelfPayment.selector);
        router.payTo(alice, 1, REF);
    }

    function test_PayTo_RevertsWhenRecipientIsRouter() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(QuickPayRouter.InvalidRecipient.selector, address(router)));
        router.payTo(address(router), 1, REF);
    }

    function test_PayTo_RevertsWhenRecipientIsUsdc() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(QuickPayRouter.InvalidRecipient.selector, address(usdc)));
        router.payTo(address(usdc), 1, REF);
    }

    function test_PayTo_RevertsOnInsufficientAllowance() public {
        vm.startPrank(alice);
        usdc.approve(address(router), 5);
        vm.expectRevert();
        router.payTo(bob, 6, REF);
        vm.stopPrank();
        assertEq(usdc.balanceOf(alice), FUNDS);
        assertEq(usdc.balanceOf(bob), 0);
    }

    function test_PayTo_RevertsOnInsufficientBalance() public {
        vm.prank(alice);
        vm.expectRevert();
        router.payTo(bob, FUNDS + 1, REF);
        assertEq(usdc.balanceOf(alice), FUNDS);
    }

    function test_PayTo_RevertsWhenTokenReturnsFalse() public {
        FalseReturnToken t = new FalseReturnToken();
        QuickPayRouter r = new QuickPayRouter(address(t), owner);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(t)));
        r.payTo(bob, 1, REF);
    }

    // ----------------------------------------------------------------- pause

    function test_Pause_OwnerCanPauseAndEmits() public {
        vm.expectEmit(false, false, false, true, address(router));
        emit Pausable.Paused(owner);
        vm.prank(owner);
        router.pause();
        assertTrue(router.paused());
    }

    function test_Pause_BlocksPayTo() public {
        vm.prank(owner);
        router.pause();
        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        router.payTo(bob, 1, REF);
        assertEq(usdc.balanceOf(bob), 0);
    }

    function test_Unpause_OwnerRestoresPaymentsAndEmits() public {
        vm.startPrank(owner);
        router.pause();
        vm.expectEmit(false, false, false, true, address(router));
        emit Pausable.Unpaused(owner);
        router.unpause();
        vm.stopPrank();
        assertFalse(router.paused());
        vm.prank(alice);
        router.payTo(bob, 7, REF);
        assertEq(usdc.balanceOf(bob), 7);
    }

    function test_Pause_NonOwnerReverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        router.pause();
    }

    function test_Unpause_NonOwnerReverts() public {
        vm.prank(owner);
        router.pause();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        router.unpause();
    }

    function test_Pause_DoubleReverts() public {
        vm.startPrank(owner);
        router.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        router.pause();
        vm.stopPrank();
    }

    function test_Unpause_WhenNotPausedReverts() public {
        vm.prank(owner);
        vm.expectRevert(Pausable.ExpectedPause.selector);
        router.unpause();
    }

    // ------------------------------------------------------------- ownership

    function test_TransferOwnership_TwoStepFlow() public {
        vm.expectEmit(true, true, false, false, address(router));
        emit Ownable2Step.OwnershipTransferStarted(owner, bob);
        vm.prank(owner);
        router.transferOwnership(bob);
        assertEq(router.owner(), owner);
        assertEq(router.pendingOwner(), bob);

        vm.expectEmit(true, true, false, false, address(router));
        emit Ownable.OwnershipTransferred(owner, bob);
        vm.prank(bob);
        router.acceptOwnership();
        assertEq(router.owner(), bob);
        assertEq(router.pendingOwner(), address(0));

        // old owner loses powers, new owner has them
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, owner));
        router.pause();
        vm.prank(bob);
        router.pause();
        assertTrue(router.paused());
    }

    function test_TransferOwnership_NonOwnerReverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        router.transferOwnership(alice);
    }

    function test_AcceptOwnership_OnlyPendingOwner() public {
        vm.prank(owner);
        router.transferOwnership(bob);
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, carol));
        router.acceptOwnership();
        assertEq(router.owner(), owner);
    }

    function test_RenounceOwnership_OwnerRevertsDisabled() public {
        vm.prank(owner);
        vm.expectRevert(QuickPayRouter.OwnershipRenunciationDisabled.selector);
        router.renounceOwnership();
        assertEq(router.owner(), owner);
    }

    function test_RenounceOwnership_NonOwnerReverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        router.renounceOwnership();
    }

    // ------------------------------------------------------------ reentrancy

    function _reentrantSetup(bool swallow) internal returns (ReentrantToken t, QuickPayRouter r) {
        t = new ReentrantToken();
        r = new QuickPayRouter(address(t), owner);
        t.configure(address(r), carol, swallow);
        t.mint(alice, 100);
    }

    function test_Reentrancy_BubbledRevertBlocksPayment() public {
        (ReentrantToken t, QuickPayRouter r) = _reentrantSetup(false);
        vm.prank(alice);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        r.payTo(bob, 10, REF);
        assertEq(t.balanceOf(alice), 100);
        assertEq(t.balanceOf(bob), 0);
        assertEq(t.balanceOf(carol), 0);
    }

    function test_Reentrancy_SwallowedAttemptIsRejectedByGuard() public {
        (ReentrantToken t, QuickPayRouter r) = _reentrantSetup(true);
        vm.prank(alice);
        r.payTo(bob, 10, REF);
        assertTrue(t.reentered());
        assertFalse(t.reentrySucceeded());
        assertEq(
            keccak256(t.lastRevertData()),
            keccak256(abi.encodeWithSelector(ReentrancyGuard.ReentrancyGuardReentrantCall.selector))
        );
        // only the outer payment happened
        assertEq(t.balanceOf(bob), 10);
        assertEq(t.balanceOf(carol), 0);
        assertEq(t.balanceOf(alice), 90);
        assertEq(t.balanceOf(address(r)), 0);
    }

    function test_Reentrancy_GuardResetsAfterPayment() public {
        (ReentrantToken t, QuickPayRouter r) = _reentrantSetup(true);
        vm.startPrank(alice);
        r.payTo(bob, 10, REF);
        r.payTo(bob, 10, REF); // second call must not be locked out
        vm.stopPrank();
        assertEq(t.balanceOf(bob), 20);
    }

    // ----------------------------------------------------------------- fuzz

    function testFuzz_PayTo_ConservesFunds(address payer, address recipient, uint256 amount, bytes32 ref) public {
        vm.assume(payer != address(0) && recipient != address(0) && payer != recipient);
        vm.assume(payer != address(router) && payer != address(usdc));
        vm.assume(recipient != address(router) && recipient != address(usdc));
        amount = bound(amount, 1, type(uint128).max);

        usdc.mint(payer, amount);
        vm.prank(payer);
        usdc.approve(address(router), amount);
        uint256 supply = usdc.totalSupply();
        uint256 recBefore = usdc.balanceOf(recipient);

        vm.expectEmit(true, true, true, true, address(router));
        emit PaymentSent(payer, recipient, amount, ref);
        vm.prank(payer);
        router.payTo(recipient, amount, ref);

        assertEq(usdc.balanceOf(payer), 0);
        assertEq(usdc.balanceOf(recipient), recBefore + amount);
        assertEq(usdc.balanceOf(address(router)), 0);
        assertEq(usdc.totalSupply(), supply);
        assertEq(usdc.allowance(payer, address(router)), 0);
    }

    function testFuzz_PayTo_RevertsIfAmountExceedsBalance(uint256 balance, uint256 extra) public {
        balance = bound(balance, 0, type(uint128).max);
        extra = bound(extra, 1, type(uint128).max);
        address payer = makeAddr("fuzzPayer");
        usdc.mint(payer, balance);
        vm.startPrank(payer);
        usdc.approve(address(router), type(uint256).max);
        vm.expectRevert();
        router.payTo(bob, balance + extra, REF);
        vm.stopPrank();
        assertEq(usdc.balanceOf(payer), balance);
    }

    function testFuzz_PayTo_PausedAlwaysReverts(address recipient, uint256 amount, bytes32 ref) public {
        vm.prank(owner);
        router.pause();
        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        router.payTo(recipient, amount, ref);
    }

    function testFuzz_Pause_OnlyOwner(address caller) public {
        vm.assume(caller != owner);
        vm.prank(caller);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, caller));
        router.pause();
    }
}

/// @dev Bounded action surface for the invariant fuzzer.
contract QuickPayRouterHandler is Test {
    QuickPayRouter public router;
    MockERC20 public usdc;
    address public owner;
    address[] public actors;

    uint256 public ghostPayments;
    uint256 public ghostRejected;

    constructor(QuickPayRouter router_, MockERC20 usdc_, address owner_) {
        router = router_;
        usdc = usdc_;
        owner = owner_;
        for (uint256 i; i < 4; ++i) {
            address a = makeAddr(string.concat("actor", vm.toString(i)));
            actors.push(a);
            usdc.mint(a, 1_000_000e6);
            vm.prank(a);
            usdc.approve(address(router), type(uint256).max);
        }
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function pay(uint256 fromSeed, uint256 toSeed, uint256 amount, bytes32 ref) external {
        uint256 from = fromSeed % actors.length;
        uint256 to = (from + 1 + (toSeed % (actors.length - 1))) % actors.length;
        uint256 bal = usdc.balanceOf(actors[from]);
        if (router.paused() || bal == 0) return;
        amount = bound(amount, 1, bal);
        vm.prank(actors[from]);
        router.payTo(actors[to], amount, ref);
        ++ghostPayments;
    }

    /// @dev Paying the router itself or USDC must always be rejected.
    function payInvalid(uint256 fromSeed, bool toRouter, uint256 amount) external {
        address from = actors[fromSeed % actors.length];
        amount = bound(amount, 1, 1e6);
        vm.prank(from);
        try router.payTo(toRouter ? address(router) : address(usdc), amount, bytes32(0)) {
            revert("invalid recipient accepted");
        } catch {
            ++ghostRejected;
        }
    }

    function togglePause() external {
        bool isPaused = router.paused();
        vm.prank(owner);
        if (isPaused) router.unpause();
        else router.pause();
    }
}

contract QuickPayRouterInvariantTest is Test {
    QuickPayRouter internal router;
    MockERC20 internal usdc;
    QuickPayRouterHandler internal handler;
    address internal owner = makeAddr("owner");

    function setUp() public {
        usdc = new MockERC20("Mock USDC", "mUSDC", 6);
        router = new QuickPayRouter(address(usdc), owner);
        handler = new QuickPayRouterHandler(router, usdc, owner);
        targetContract(address(handler));
    }

    /// PROPERTY: the router is non-custodial and never holds USDC.
    function invariant_RouterNeverHoldsUsdc() public view {
        assertEq(usdc.balanceOf(address(router)), 0);
    }

    /// PROPERTY: payments only move funds between actors (supply conserved).
    function invariant_FundsConservedAmongActors() public view {
        uint256 sum;
        for (uint256 i; i < handler.actorCount(); ++i) {
            sum += usdc.balanceOf(handler.actors(i));
        }
        assertEq(sum, usdc.totalSupply());
    }

    /// PROPERTY: the router never holds native currency either.
    function invariant_RouterHoldsNoNative() public view {
        assertEq(address(router).balance, 0);
    }
}
