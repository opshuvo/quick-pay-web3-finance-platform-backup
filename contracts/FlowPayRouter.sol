// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title Quick Pay direct USDC payment router
/// @notice Non-custodial: no escrow, no fees, and no upgradeability.
/// @dev Payments transfer the constructor-configured USDC directly from payer to
/// recipient. Call this router as the transaction destination to route a payment.
/// Amounts use USDC's six-decimal base units. Arc Mainnet's ERC-20 USDC address is
/// 0x3600000000000000000000000000000000000000. The deployment must supply genuine
/// USDC; checking for code does not authenticate a token. No payable entry point
/// or fund recovery mechanism exists. Unsolicited ERC-20 transfers or forced
/// native transfers cannot be prevented and would be stranded; never send funds
/// to this router. Ownership uses OpenZeppelin's two-step transfer; renunciation
/// is disabled. Owner administration is limited to pausing/unpausing and
/// transferring ownership.
contract QuickPayRouter is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

        IERC20 public immutable usdc;

            error ZeroAddress();
                error TokenHasNoCode(address token);
                    error ZeroAmount();
                        error SelfPayment();
                            error InvalidRecipient(address recipient);
                                error OwnershipRenunciationDisabled();

                                    event PaymentSent(
                                            address indexed payer,
                                                    address indexed recipient,
                                                            uint256 amount,
                                                                    bytes32 indexed reference_
                                                                        );

                                                                            /// @notice Deploys a router for the supplied USDC and initial pause administrator.
                                                                                /// @param usdc_ ERC-20 USDC contract address (six decimals).
                                                                                    /// @param initialOwner Nonzero initial owner; subsequent transfers require acceptance.
                                                                                        constructor(address usdc_, address initialOwner) Ownable(initialOwner) {
                                                                                                // Ownable also rejects a zero initialOwner with its own custom error.
                                                                                                        if (usdc_ == address(0) || initialOwner == address(0)) revert ZeroAddress();
                                                                                                                if (usdc_.code.length == 0) revert TokenHasNoCode(usdc_);
                                                                                                                        usdc = IERC20(usdc_);
                                                                                                                            }

                                                                                                                                /// @notice Sends approved USDC directly from the caller to the recipient.
                                                                                                                                    /// @dev Payers should approve this router for the exact payment amount only.
                                                                                                                                        /// A failed transfer reverts the entire call; the router never takes custody
                                                                                                                                            /// during payment. References are caller-supplied metadata, not unique IDs.
                                                                                                                                                /// @param recipient Nonzero recipient, distinct from caller, router, and USDC.
                                                                                                                                                    /// @param amount Positive amount in USDC base units (1 USDC = 1,000,000 units).
                                                                                                                                                        /// @param reference_ Public payment reference; zero and repeated values are allowed.
                                                                                                                                                            function payTo(address recipient, uint256 amount, bytes32 reference_)
                                                                                                                                                                    external
                                                                                                                                                                            nonReentrant
                                                                                                                                                                                    whenNotPaused
                                                                                                                                                                                        {
                                                                                                                                                                                                if (recipient == address(0)) revert ZeroAddress();
                                                                                                                                                                                                        if (amount == 0) revert ZeroAmount();
                                                                                                                                                                                                                if (recipient == msg.sender) revert SelfPayment();
                                                                                                                                                                                                                        if (recipient == address(this) || recipient == address(usdc)) {
                                                                                                                                                                                                                                    revert InvalidRecipient(recipient);
                                                                                                                                                                                                                                            }

                                                                                                                                                                                                                                                    usdc.safeTransferFrom(msg.sender, recipient, amount);
                                                                                                                                                                                                                                                            emit PaymentSent(msg.sender, recipient, amount, reference_);
                                                                                                                                                                                                                                                                }

                                                                                                                                                                                                                                                                    /// @notice Pauses payments.
                                                                                                                                                                                                                                                                        /// @dev Only the owner may call; emits OpenZeppelin's Paused event.
                                                                                                                                                                                                                                                                            function pause() external onlyOwner {
                                                                                                                                                                                                                                                                                    _pause();
                                                                                                                                                                                                                                                                                        }

                                                                                                                                                                                                                                                                                            /// @notice Resumes payments.
                                                                                                                                                                                                                                                                                                /// @dev Only the owner may call; emits OpenZeppelin's Unpaused event.
                                                                                                                                                                                                                                                                                                    function unpause() external onlyOwner {
                                                                                                                                                                                                                                                                                                            _unpause();
                                                                                                                                                                                                                                                                                                                }

                                                                                                                                                                                                                                                                                                                    /// @notice Always reverts to preserve an owner capable of pausing the router.
                                                                                                                                                                                                                                                                                                                        /// @dev Transfer ownership through the inherited two-step process instead.
                                                                                                                                                                                                                                                                                                                            function renounceOwnership() public view override onlyOwner {
                                                                                                                                                                                                                                                                                                                                    revert OwnershipRenunciationDisabled();
                                                                                                                                                                                                                                                                                                                                        }
                                                                                                                                                                                                                                                                                                                                        }
