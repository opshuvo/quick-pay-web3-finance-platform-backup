// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title Quick Pay request and receipt registry
/// @notice Non-custodial and unaudited: no escrow, no fees, and no upgradeability.
/// Descriptions are stored off-chain and only their hash is on-chain.
/// @dev Payments transfer the constructor-configured USDC directly from payer to merchant.
/// Amounts use USDC's six-decimal base units. The deployment must supply genuine USDC;
/// checking for code does not authenticate a token. No payable entry point or fund
/// recovery mechanism exists. Unsolicited ERC-20 transfers or forced native transfers
/// cannot be prevented and would be stranded; never send funds to this registry.
/// Ownership uses OpenZeppelin's two-step transfer; renunciation is disabled.
/// Owner administration is limited to pausing/unpausing and transferring ownership.
contract QuickPayRegistry is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status { None, Open, Paid, Cancelled }
    enum EffectiveStatus { None, Open, Paid, Cancelled, Expired }

    /// @dev Fields are reordered for storage packing; timestamps are Unix seconds.
    struct Request {
        address merchant;
        uint64 createdAt;
        address payer;
        uint64 expiresAt;
        uint128 amount;
        uint64 paidAt;
        address paidBy;
        Status status;
        bytes32 descriptionHash;
    }

    IERC20 public immutable usdc;
    uint256 private _requestCount;
    mapping(uint256 id => Request request) private _requests;

    error ZeroAddress();
    error TokenHasNoCode(address token);
    error ZeroAmount();
    error InvalidExpiry(uint64 expiresAt);
    error RequestNotOpen(uint256 id);
    error NotMerchant(uint256 id, address caller);
    error RequestExpired(uint256 id);
    error NotDesignatedPayer(uint256 id, address caller);
    error SelfPayment(uint256 id);
    error OwnershipRenunciationDisabled();

    event RequestCreated(
        uint256 indexed id,
        address indexed merchant,
        address indexed payer,
        uint128 amount,
        uint64 expiresAt,
        bytes32 descriptionHash
    );
    event RequestCancelled(uint256 indexed id, address indexed merchant);
    event PaymentReceived(
        uint256 indexed id,
        address indexed merchant,
        address indexed payer,
        uint128 amount,
        uint64 paidAt
    );

    /// @notice Deploys a registry for the supplied USDC and initial pause administrator.
    /// @param usdc_ ERC-20 USDC contract address (six decimals, not a native-token sentinel).
    /// @param initialOwner Nonzero initial owner; subsequent transfers require acceptance.
    constructor(address usdc_, address initialOwner) Ownable(initialOwner) {
        // Ownable also rejects a zero initialOwner with its own custom error.
        if (usdc_ == address(0) || initialOwner == address(0)) revert ZeroAddress();
        if (usdc_.code.length == 0) revert TokenHasNoCode(usdc_);
        usdc = IERC20(usdc_);
    }

    /// @notice Creates an open request belonging to the caller without moving funds.
    /// @param amount Positive amount in USDC base units (1 USDC = 1,000,000 units).
    /// @param payer Designated payer, or zero to allow anyone except the merchant.
    /// @param expiresAt Future Unix timestamp, or zero for no expiry.
    /// @param descriptionHash Hash of an off-chain description; no plaintext is stored.
    /// @return id Sequential identifier, starting at one.
    function createRequest(
        uint128 amount,
        address payer,
        uint64 expiresAt,
        bytes32 descriptionHash
    ) external whenNotPaused returns (uint256 id) {
        if (amount == 0) revert ZeroAmount();
        if (expiresAt != 0 && expiresAt <= block.timestamp) revert InvalidExpiry(expiresAt);

        id = ++_requestCount;
        _requests[id] = Request({
            merchant: msg.sender,
            createdAt: uint64(block.timestamp),
            payer: payer,
            expiresAt: expiresAt,
            amount: amount,
            paidAt: 0,
            paidBy: address(0),
            status: Status.Open,
            descriptionHash: descriptionHash
        });
        emit RequestCreated(id, msg.sender, payer, amount, expiresAt, descriptionHash);
    }

    /// @notice Cancels the caller's open request, including while paused or expired.
    /// @param id Request identifier; nonexistent or non-open requests revert.
    function cancelRequest(uint256 id) external {
        Request storage request = _requests[id];
        if (request.status != Status.Open) revert RequestNotOpen(id);
        if (msg.sender != request.merchant) revert NotMerchant(id, msg.sender);
        request.status = Status.Cancelled;
        emit RequestCancelled(id, request.merchant);
    }

    /// @notice Pays an eligible open request directly from caller to merchant.
    /// @dev Caller must approve this registry to spend USDC first. Receipt state is
    /// updated before the transfer; a failed transfer reverts all state and events.
    /// Payment is allowed at exactly expiresAt, but not after it.
    /// @param id Request identifier.
    function pay(uint256 id) external nonReentrant whenNotPaused {
        Request storage request = _requests[id];
        if (request.status != Status.Open) revert RequestNotOpen(id);
        if (request.expiresAt != 0 && block.timestamp > request.expiresAt) {
            revert RequestExpired(id);
        }
        if (request.payer != address(0) && msg.sender != request.payer) {
            revert NotDesignatedPayer(id, msg.sender);
        }
        if (msg.sender == request.merchant) revert SelfPayment(id);

        uint64 paidAt = uint64(block.timestamp);
        request.status = Status.Paid;
        request.paidAt = paidAt;
        request.paidBy = msg.sender;

        usdc.safeTransferFrom(msg.sender, request.merchant, request.amount);
        emit PaymentReceived(id, request.merchant, msg.sender, request.amount, paidAt);
    }

    /// @notice Returns stored request fields; an unknown identifier returns zeroed fields.
    /// @dev Stored Open status does not change automatically on expiry; use statusOf.
    /// @param id Request identifier.
    /// @return request Stored request, including its on-chain description hash.
    function getRequest(uint256 id) external view returns (Request memory request) {
        return _requests[id];
    }

    /// @notice Returns effective status, distinguishing expired open requests.
    /// @param id Request identifier; unknown identifiers return None.
    /// @return Effective status; paid and cancelled requests retain their final status.
    function statusOf(uint256 id) external view returns (EffectiveStatus) {
        Request storage request = _requests[id];
        if (
            request.status == Status.Open && request.expiresAt != 0
                && block.timestamp > request.expiresAt
        ) return EffectiveStatus.Expired;
        return EffectiveStatus(uint8(request.status));
    }

    /// @notice Returns the identifier that the next successful creation will use.
    /// @return Next sequential request identifier.
    function nextRequestId() external view returns (uint256) {
        return _requestCount + 1;
    }

    /// @notice Returns the total number of requests ever created, including closed ones.
    /// @return Total request count.
    function requestCount() external view returns (uint256) {
        return _requestCount;
    }

    /// @notice Pauses creation and payment; merchant cancellation remains available.
    /// @dev Only the owner may call; emits OpenZeppelin's Paused event.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resumes creation and payment.
    /// @dev Only the owner may call; emits OpenZeppelin's Unpaused event.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Always reverts to preserve an owner capable of pausing the registry.
    /// @dev Transfer ownership through the inherited two-step process instead.
    function renounceOwnership() public view override onlyOwner {
        revert OwnershipRenunciationDisabled();
    }
}
