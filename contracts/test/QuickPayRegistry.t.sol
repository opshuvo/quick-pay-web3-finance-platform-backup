// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {QuickPayRegistry} from "../QuickPayRegistry.sol";

/// @dev Minimal 6-decimals ERC20 used as USDC.
contract MockUSDC {
    string public name = "Mock USDC";
    string public symbol = "mUSDC";
    uint8 public constant decimals = 6;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amt) external {
        totalSupply += amt;
        balanceOf[to] += amt;
        emit Transfer(address(0), to, amt);
    }

    function approve(address spender, uint256 amt) external returns (bool) {
        allowance[msg.sender][spender] = amt;
        emit Approval(msg.sender, spender, amt);
        return true;
    }

    function transfer(address to, uint256 amt) external returns (bool) {
        _move(msg.sender, to, amt);
        return true;
    }

    function transferFrom(address from, address to, uint256 amt) external virtual returns (bool) {
        _spend(from, amt);
        _move(from, to, amt);
        return true;
    }

    function _spend(address from, uint256 amt) internal {
        uint256 a = allowance[from][msg.sender];
        require(a >= amt, "allowance");
        if (a != type(uint256).max) allowance[from][msg.sender] = a - amt;
    }

    function _move(address from, address to, uint256 amt) internal {
        require(balanceOf[from] >= amt, "balance");
        balanceOf[from] -= amt;
        balanceOf[to] += amt;
        emit Transfer(from, to, amt);
    }
}

/// @dev Token that re-enters the registry's pay() during transferFrom.
contract ReentrantToken is MockUSDC {
    address public registry;
    uint256 public targetId;
    bool public propagate;
    bool public attempted;
    bool public reentrySucceeded;
    bytes public reentryReturn;

    function arm(address reg, uint256 id, bool bubble) external {
        registry = reg;
        targetId = id;
        propagate = bubble;
    }

    function transferFrom(address from, address to, uint256 amt) external override returns (bool) {
        _spend(from, amt);
        _move(from, to, amt);
        if (registry != address(0) && !attempted) {
            attempted = true;
            (bool ok, bytes memory ret) =
                registry.call(abi.encodeWithSelector(QuickPayRegistry.pay.selector, targetId));
            reentrySucceeded = ok;
            reentryReturn = ret;
            if (!ok && propagate) {
                assembly {
                    revert(add(ret, 0x20), mload(ret))
                }
            }
        }
        return true;
    }
}

contract QuickPayRegistryTest is Test {
    QuickPayRegistry internal reg;
    MockUSDC internal usdc;

    address internal owner = makeAddr("owner");
    address internal merchant = makeAddr("merchant");
    address internal payer = makeAddr("payer");
    address internal other = makeAddr("other");

    uint256 internal constant T0 = 1_000_000;
    uint128 internal constant AMT = 25e6;
    bytes32 internal constant H = keccak256("invoice #1");

    function setUp() public virtual {
        vm.warp(T0);
        usdc = new MockUSDC();
        reg = new QuickPayRegistry(address(usdc), owner);
        usdc.mint(payer, 1_000e6);
        usdc.mint(other, 1_000e6);
        usdc.mint(merchant, 1_000e6);
        vm.prank(payer);
        usdc.approve(address(reg), type(uint256).max);
        vm.prank(other);
        usdc.approve(address(reg), type(uint256).max);
        vm.prank(merchant);
        usdc.approve(address(reg), type(uint256).max);
    }

    function _create(address who, uint128 amt, address designated, uint64 exp) internal returns (uint256 id) {
        vm.prank(who);
        id = reg.createRequest(amt, designated, exp, H);
    }

    function _open() internal returns (uint256) {
        return _create(merchant, AMT, address(0), 0);
    }

    // ───────────── Deployment ─────────────

    function test_Constructor_SetsState() public view {
        assertEq(address(reg.usdc()), address(usdc));
        assertEq(reg.owner(), owner);
        assertEq(reg.pendingOwner(), address(0));
        assertFalse(reg.paused());
        assertEq(reg.requestCount(), 0);
        assertEq(reg.nextRequestId(), 1);
    }

    function test_Constructor_RevertsZeroUsdc() public {
        vm.expectRevert(QuickPayRegistry.ZeroAddress.selector);
        new QuickPayRegistry(address(0), owner);
    }

    function test_Constructor_RevertsZeroOwner() public {
        // Ownable's constructor runs first, so its own error surfaces.
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new QuickPayRegistry(address(usdc), address(0));
    }

    function test_Constructor_RevertsTokenWithoutCode() public {
        address eoa = makeAddr("eoa");
        vm.expectRevert(abi.encodeWithSelector(QuickPayRegistry.TokenHasNoCode.selector, eoa));
        new QuickPayRegistry(eoa, owner);
    }

    // ───────────── createRequest ─────────────

    function test_Create_StoresRequest() public {
        uint256 id = _create(merchant, AMT, payer, uint64(T0 + 1 days));
        assertEq(id, 1);
        QuickPayRegistry.Request memory r = reg.getRequest(id);
        assertEq(r.merchant, merchant);
        assertEq(r.payer, payer);
        assertEq(r.amount, AMT);
        assertEq(r.createdAt, T0);
        assertEq(r.expiresAt, T0 + 1 days);
        assertEq(r.paidAt, 0);
        assertEq(r.paidBy, address(0));
        assertEq(uint8(r.status), uint8(QuickPayRegistry.Status.Open));
        assertEq(r.descriptionHash, H);
        assertEq(uint8(reg.statusOf(id)), uint8(QuickPayRegistry.EffectiveStatus.Open));
        assertEq(usdc.balanceOf(address(reg)), 0);
    }

    function test_Create_EmitsEvent() public {
        vm.expectEmit(true, true, true, true, address(reg));
        emit QuickPayRegistry.RequestCreated(1, merchant, payer, AMT, uint64(T0 + 10), H);
        _create(merchant, AMT, payer, uint64(T0 + 10));
    }

    function test_Create_SequentialIds() public {
        assertEq(_open(), 1);
        assertEq(_create(other, 5, address(0), 0), 2);
        assertEq(reg.requestCount(), 2);
        assertEq(reg.nextRequestId(), 3);
    }

    function test_Create_NoExpiryAllowed() public {
        uint256 id = _open();
        vm.warp(block.timestamp + 365 days * 50);
        assertEq(uint8(reg.statusOf(id)), uint8(QuickPayRegistry.EffectiveStatus.Open));
    }

    function test_Create_ExpiryOneSecondAheadOk() public {
        uint256 id = _create(merchant, AMT, address(0), uint64(T0 + 1));
        assertEq(id, 1);
    }

    function test_Create_RevertsZeroAmount() public {
        vm.prank(merchant);
        vm.expectRevert(QuickPayRegistry.ZeroAmount.selector);
        reg.createRequest(0, address(0), 0, H);
    }

    function test_Create_RevertsExpiryEqualNow() public {
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSelector(QuickPayRegistry.InvalidExpiry.selector, uint64(T0)));
        reg.createRequest(AMT, address(0), uint64(T0), H);
    }

    function test_Create_RevertsExpiryInPast() public {
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSelector(QuickPayRegistry.InvalidExpiry.selector, uint64(T0 - 1)));
        reg.createRequest(AMT, address(0), uint64(T0 - 1), H);
    }

    function test_Create_RevertsWhenPaused() public {
        vm.prank(owner);
        reg.pause();
        vm.prank(merchant);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        reg.createRequest(AMT, address(0), 0, H);
    }

    // ───────────── cancelRequest ─────────────

    function test_Cancel_ByMerchant() public {
        uint256 id = _open();
        vm.expectEmit(true, true, false, false, address(reg));
        emit QuickPayRegistry.RequestCancelled(id, merchant);
        vm.prank(merchant);
        reg.cancelRequest(id);
        assertEq(uint8(reg.statusOf(id)), uint8(QuickPayRegistry.EffectiveStatus.Cancelled));
    }

    function test_Cancel_RevertsNonMerchant() public {
        uint256 id = _open();
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(QuickPayRegistry.NotMerchant.selector, id, other));
        reg.cancelRequest(id);
    }

    function test_Cancel_RevertsNonexistent() public {
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSelector(QuickPayRegistry.RequestNotOpen.selector, 99));
        reg.cancelRequest(99);
    }

    function test_Cancel_RevertsTwice() public {
        uint256 id = _open();
        vm.startPrank(merchant);
        reg.cancelRequest(id);
        vm.expectRevert(abi.encodeWithSelector(QuickPayRegistry.RequestNotOpen.selector, id));
        reg.cancelRequest(id);
        vm.stopPrank();
    }

    function test_Cancel_RevertsAfterPaid() public {
        uint256 id = _open();
        vm.prank(payer);
        reg.pay(id);
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSelector(QuickPayRegistry.RequestNotOpen.selector, id));
        reg.cancelRequest(id);
    }

    function test_Cancel_WhilePausedSucceeds() public {
        uint256 id = _open();
        vm.prank(owner);
        reg.pause();
        vm.prank(merchant);
        reg.cancelRequest(id);
        assertEq(uint8(reg.statusOf(id)), uint8(QuickPayRegistry.EffectiveStatus.Cancelled));
    }

    function test_Cancel_ExpiredOpenSucceeds() public {
        uint256 id = _create(merchant, AMT, address(0), uint64(T0 + 100));
        vm.warp(T0 + 101);
        assertEq(uint8(reg.statusOf(id)), uint8(QuickPayRegistry.EffectiveStatus.Expired));
        vm.prank(merchant);
        reg.cancelRequest(id);
        assertEq(uint8(reg.statusOf(id)), uint8(QuickPayRegistry.EffectiveStatus.Cancelled));
    }

    // ───────────── pay ─────────────

    function test_Pay_OpenToAnyone() public {
        uint256 id = _open();
        uint256 pb = usdc.balanceOf(other);
        uint256 mb = usdc.balanceOf(merchant);
        vm.warp(T0 + 5);
        vm.expectEmit(true, true, true, true, address(reg));
        emit QuickPayRegistry.PaymentReceived(id, merchant, other, AMT, uint64(T0 + 5));
        vm.prank(other);
        reg.pay(id);

        assertEq(usdc.balanceOf(other), pb - AMT);
        assertEq(usdc.balanceOf(merchant), mb + AMT);
        assertEq(usdc.balanceOf(address(reg)), 0);
        QuickPayRegistry.Request memory r = reg.getRequest(id);
        assertEq(uint8(r.status), uint8(QuickPayRegistry.Status.Paid));
        assertEq(r.paidAt, T0 + 5);
        assertEq(r.paidBy, other);
        assertEq(uint8(reg.statusOf(id)), uint8(QuickPayRegistry.EffectiveStatus.Paid));
    }

    function test_Pay_DesignatedPayerSucceeds() public {
        uint256 id = _create(merchant, AMT, payer, 0);
        vm.prank(payer);
        reg.pay(id);
        assertEq(reg.getRequest(id).paidBy, payer);
    }

    function test_Pay_RevertsWrongPayerWhenDesignated() public {
        uint256 id = _create(merchant, AMT, payer, 0);
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(QuickPayRegistry.NotDesignatedPayer.selector, id, other));
        reg.pay(id);
        assertEq(uint8(reg.statusOf(id)), uint8(QuickPayRegistry.EffectiveStatus.Open));
    }

    function test_Pay_RevertsSelfPayment() public {
        uint256 id = _open();
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSelector(QuickPayRegistry.SelfPayment.selector, id));
        reg.pay(id);
    }

    function test_Pay_RevertsSelfPaymentWhenMerchantIsDesignated() public {
        uint256 id = _create(merchant, AMT, merchant, 0);
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSelector(QuickPayRegistry.SelfPayment.selector, id));
        reg.pay(id);
    }

    function test_Pay_RevertsNonexistent() public {
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(QuickPayRegistry.RequestNotOpen.selector, 7));
        reg.pay(7);
    }

    function test_Pay_RevertsAlreadyPaid() public {
        uint256 id = _open();
        vm.prank(payer);
        reg.pay(id);
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(QuickPayRegistry.RequestNotOpen.selector, id));
        reg.pay(id);
    }

    function test_Pay_RevertsCancelled() public {
        uint256 id = _open();
        vm.prank(merchant);
        reg.cancelRequest(id);
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(QuickPayRegistry.RequestNotOpen.selector, id));
        reg.pay(id);
    }

    function test_Pay_RevertsWhenPaused() public {
        uint256 id = _open();
        vm.prank(owner);
        reg.pause();
        vm.prank(payer);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        reg.pay(id);
        vm.prank(owner);
        reg.unpause();
        vm.prank(payer);
        reg.pay(id);
        assertEq(uint8(reg.statusOf(id)), uint8(QuickPayRegistry.EffectiveStatus.Paid));
    }

    function test_Expiry_PayAtExactlyExpiresAtSucceeds() public {
        uint64 exp = uint64(T0 + 100);
        uint256 id = _create(merchant, AMT, address(0), exp);
        vm.warp(exp);
        assertEq(uint8(reg.statusOf(id)), uint8(QuickPayRegistry.EffectiveStatus.Open));
        vm.prank(payer);
        reg.pay(id);
        assertEq(uint8(reg.statusOf(id)), uint8(QuickPayRegistry.EffectiveStatus.Paid));
    }

    function test_Expiry_PayOneSecondAfterReverts() public {
        uint64 exp = uint64(T0 + 100);
        uint256 id = _create(merchant, AMT, address(0), exp);
        vm.warp(uint256(exp) + 1);
        assertEq(uint8(reg.statusOf(id)), uint8(QuickPayRegistry.EffectiveStatus.Expired));
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(QuickPayRegistry.RequestExpired.selector, id));
        reg.pay(id);
    }

    function test_Pay_RevertsInsufficientAllowanceAndKeepsOpen() public {
        address poor = makeAddr("poor");
        uint256 id = _open();
        vm.prank(poor);
        vm.expectRevert();
        reg.pay(id);
        assertEq(uint8(reg.statusOf(id)), uint8(QuickPayRegistry.EffectiveStatus.Open));
        assertEq(reg.getRequest(id).paidBy, address(0));
    }

    function test_Pay_RevertsInsufficientBalance() public {
        address poor = makeAddr("poor");
        vm.prank(poor);
        usdc.approve(address(reg), type(uint256).max);
        uint256 id = _open();
        vm.prank(poor);
        vm.expectRevert();
        reg.pay(id);
        assertEq(uint8(reg.statusOf(id)), uint8(QuickPayRegistry.EffectiveStatus.Open));
    }

    function test_StatusOf_UnknownIsNone() public view {
        assertEq(uint8(reg.statusOf(123)), uint8(QuickPayRegistry.EffectiveStatus.None));
        assertEq(reg.getRequest(123).merchant, address(0));
    }

    // ───────────── Reentrancy via malicious token ─────────────

    function _evilSetup(bool bubble) internal returns (ReentrantToken evil, QuickPayRegistry r, uint256 id) {
        evil = new ReentrantToken();
        r = new QuickPayRegistry(address(evil), owner);
        evil.mint(payer, 100e6);
        vm.prank(payer);
        evil.approve(address(r), type(uint256).max);
        vm.prank(merchant);
        id = r.createRequest(AMT, address(0), 0, H);
        evil.arm(address(r), id, bubble);
    }

    function test_Reentrancy_BlockedAndOuterPaymentCompletes() public {
        (ReentrantToken evil, QuickPayRegistry r, uint256 id) = _evilSetup(false);
        vm.prank(payer);
        r.pay(id);
        assertTrue(evil.attempted());
        assertFalse(evil.reentrySucceeded());
        assertEq(
            bytes4(evil.reentryReturn()), ReentrancyGuard.ReentrancyGuardReentrantCall.selector
        );
        assertEq(evil.balanceOf(merchant), AMT);
        assertEq(evil.balanceOf(payer), 100e6 - AMT);
        assertEq(evil.balanceOf(address(r)), 0);
        assertEq(uint8(r.statusOf(id)), uint8(QuickPayRegistry.EffectiveStatus.Paid));
    }

    function test_Reentrancy_PropagatedRevertRollsEverythingBack() public {
        (ReentrantToken evil, QuickPayRegistry r, uint256 id) = _evilSetup(true);
        vm.prank(payer);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        r.pay(id);
        assertEq(uint8(r.statusOf(id)), uint8(QuickPayRegistry.EffectiveStatus.Open));
        assertEq(evil.balanceOf(payer), 100e6);
        assertEq(evil.balanceOf(merchant), 0);
    }

    // ───────────── Pause / unpause ─────────────

    function test_Pause_ByOwnerEmits() public {
        vm.expectEmit(false, false, false, true, address(reg));
        emit Pausable.Paused(owner);
        vm.prank(owner);
        reg.pause();
        assertTrue(reg.paused());
    }

    function test_Unpause_ByOwnerEmits() public {
        vm.prank(owner);
        reg.pause();
        vm.expectEmit(false, false, false, true, address(reg));
        emit Pausable.Unpaused(owner);
        vm.prank(owner);
        reg.unpause();
        assertFalse(reg.paused());
    }

    function test_Pause_RevertsNonOwner() public {
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, other));
        reg.pause();
    }

    function test_Unpause_RevertsNonOwner() public {
        vm.prank(owner);
        reg.pause();
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, other));
        reg.unpause();
    }

    function test_Pause_RevertsWhenAlreadyPaused() public {
        vm.startPrank(owner);
        reg.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        reg.pause();
        vm.stopPrank();
    }

    function test_Unpause_RevertsWhenNotPaused() public {
        vm.prank(owner);
        vm.expectRevert(Pausable.ExpectedPause.selector);
        reg.unpause();
    }

    // ───────────── Ownable2Step / renounce ─────────────

    function test_Ownership_TwoStepHandoff() public {
        address newOwner = makeAddr("newOwner");
        vm.expectEmit(true, true, false, false, address(reg));
        emit Ownable2Step.OwnershipTransferStarted(owner, newOwner);
        vm.prank(owner);
        reg.transferOwnership(newOwner);
        assertEq(reg.owner(), owner);
        assertEq(reg.pendingOwner(), newOwner);

        // pending owner has no powers yet
        vm.prank(newOwner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, newOwner));
        reg.pause();

        vm.expectEmit(true, true, false, false, address(reg));
        emit Ownable.OwnershipTransferred(owner, newOwner);
        vm.prank(newOwner);
        reg.acceptOwnership();
        assertEq(reg.owner(), newOwner);
        assertEq(reg.pendingOwner(), address(0));

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, owner));
        reg.pause();
        vm.prank(newOwner);
        reg.pause();
        assertTrue(reg.paused());
    }

    function test_Ownership_AcceptRevertsForNonPending() public {
        address newOwner = makeAddr("newOwner");
        vm.prank(owner);
        reg.transferOwnership(newOwner);
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, other));
        reg.acceptOwnership();
        assertEq(reg.owner(), owner);
    }

    function test_Ownership_TransferRevertsNonOwner() public {
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, other));
        reg.transferOwnership(other);
    }

    function test_RenounceOwnership_RevertsForOwner() public {
        vm.prank(owner);
        vm.expectRevert(QuickPayRegistry.OwnershipRenunciationDisabled.selector);
        reg.renounceOwnership();
        assertEq(reg.owner(), owner);
    }

    function test_RenounceOwnership_RevertsForNonOwner() public {
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, other));
        reg.renounceOwnership();
    }

    // ───────────── Fuzz ─────────────

    function testFuzz_PayMovesExactAmountMerchantToPayer(uint128 amount, address who) public {
        amount = uint128(bound(amount, 1, type(uint128).max));
        vm.assume(who != merchant && who != address(reg) && who != address(0));
        vm.assume(who != address(usdc));
        uint256 mBefore = usdc.balanceOf(merchant);
        usdc.mint(who, amount);
        vm.prank(who);
        usdc.approve(address(reg), amount);

        uint256 id = _create(merchant, amount, address(0), 0);
        uint256 whoBefore = usdc.balanceOf(who);
        vm.prank(who);
        reg.pay(id);

        assertEq(usdc.balanceOf(who), whoBefore - amount);
        assertEq(usdc.balanceOf(merchant), mBefore + amount);
        assertEq(usdc.balanceOf(address(reg)), 0);
        assertEq(reg.getRequest(id).amount, amount);
    }

    function testFuzz_CreateExpiryValidity(uint64 exp) public {
        vm.prank(merchant);
        if (exp != 0 && exp <= T0) {
            vm.expectRevert(abi.encodeWithSelector(QuickPayRegistry.InvalidExpiry.selector, exp));
            reg.createRequest(AMT, address(0), exp, H);
        } else {
            uint256 id = reg.createRequest(AMT, address(0), exp, H);
            assertEq(reg.getRequest(id).expiresAt, exp);
        }
    }

    function testFuzz_ExpiryBoundary(uint64 offset, uint64 payOffset) public {
        offset = uint64(bound(offset, 1, 365 days));
        payOffset = uint64(bound(payOffset, 0, 400 days));
        uint64 exp = uint64(T0) + offset;
        uint256 id = _create(merchant, AMT, address(0), exp);
        vm.warp(T0 + payOffset);
        vm.prank(payer);
        if (T0 + payOffset > exp) {
            assertEq(uint8(reg.statusOf(id)), uint8(QuickPayRegistry.EffectiveStatus.Expired));
            vm.expectRevert(abi.encodeWithSelector(QuickPayRegistry.RequestExpired.selector, id));
            reg.pay(id);
        } else {
            reg.pay(id);
            assertEq(uint8(reg.statusOf(id)), uint8(QuickPayRegistry.EffectiveStatus.Paid));
        }
    }
}

/// @dev Drives random create/pay/cancel/warp/pause sequences.
contract QuickPayHandler is Test {
    QuickPayRegistry public reg;
    MockUSDC public usdc;
    address public owner;
    address[3] public actors;
    uint256[] internal _paidIds;

    constructor(QuickPayRegistry r, MockUSDC u, address o) {
        reg = r;
        usdc = u;
        owner = o;
        for (uint256 i; i < 3; ++i) {
            actors[i] = makeAddr(string(abi.encodePacked("actor", vm.toString(i))));
            u.mint(actors[i], 1_000_000e6);
            vm.prank(actors[i]);
            u.approve(address(r), type(uint256).max);
        }
    }

    function paidCount() external view returns (uint256) {
        return _paidIds.length;
    }

    function paidId(uint256 i) external view returns (uint256) {
        return _paidIds[i];
    }

    function create(uint256 a, uint256 p, uint128 amount, uint64 expDelta) external {
        amount = uint128(bound(amount, 1, 1_000e6));
        address designated = p % 4 == 3 ? address(0) : actors[p % 3];
        uint64 exp = expDelta % 2 == 0 ? 0 : uint64(block.timestamp + bound(expDelta, 1, 1 days));
        vm.prank(actors[a % 3]);
        try reg.createRequest(amount, designated, exp, bytes32(uint256(amount))) {} catch {}
    }

    function pay(uint256 a, uint256 idSeed) external {
        uint256 n = reg.requestCount();
        if (n == 0) return;
        uint256 id = bound(idSeed, 1, n);
        vm.prank(actors[a % 3]);
        try reg.pay(id) {
            _paidIds.push(id);
        } catch {}
    }

    function cancel(uint256 a, uint256 idSeed) external {
        uint256 n = reg.requestCount();
        if (n == 0) return;
        vm.prank(actors[a % 3]);
        try reg.cancelRequest(bound(idSeed, 1, n)) {} catch {}
    }

    function warp(uint256 dt) external {
        skip(bound(dt, 0, 2 days));
    }

    function setPaused(bool on) external {
        vm.prank(owner);
        if (on) {
            try reg.pause() {} catch {}
        } else {
            try reg.unpause() {} catch {}
        }
    }
}

contract QuickPayRegistryInvariantTest is Test {
    QuickPayRegistry internal reg;
    MockUSDC internal usdc;
    QuickPayHandler internal handler;

    function setUp() public {
        vm.warp(1_000_000);
        usdc = new MockUSDC();
        reg = new QuickPayRegistry(address(usdc), makeAddr("owner"));
        handler = new QuickPayHandler(reg, usdc, makeAddr("owner"));
        targetContract(address(handler));
    }

    /// Sanity: the handler can actually drive a request to Paid (invariants not vacuous).
    function test_HandlerCanReachPaid() public {
        handler.create(0, 3, 10e6, 0); // actor0 merchant, anyone may pay
        handler.pay(1, 1); // actor1 pays id 1
        assertEq(handler.paidCount(), 1);
        assertEq(usdc.balanceOf(address(reg)), 0);
    }

    /// Registry never holds USDC and token is conserved among actors.
    function invariant_RegistryHoldsNoUsdc() public view {
        assertEq(usdc.balanceOf(address(reg)), 0);
        uint256 sum;
        for (uint256 i; i < 3; ++i) sum += usdc.balanceOf(handler.actors(i));
        assertEq(sum, usdc.totalSupply());
    }

    /// A Paid request never reverts to Open/Cancelled/Expired.
    function invariant_PaidNeverReverts() public view {
        uint256 n = handler.paidCount();
        for (uint256 i; i < n; ++i) {
            uint256 id = handler.paidId(i);
            QuickPayRegistry.Request memory r = reg.getRequest(id);
            assertEq(uint8(r.status), uint8(QuickPayRegistry.Status.Paid));
            assertEq(uint8(reg.statusOf(id)), uint8(QuickPayRegistry.EffectiveStatus.Paid));
            assertTrue(r.paidBy != address(0) && r.paidBy != r.merchant);
        }
    }
}
