// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {Test, console2} from "forge-std/Test.sol";
import {Hindsight} from "../src/Hindsight.sol";

contract HindsightTest is Test {
    Hindsight public hindsight;

    address public alice = address(0xA11CE);
    address public bob = address(0xB0B);
    address public carol = address(0xCA201);
    address public dave = address(0xDA7E);

    bytes32 public constant SALT_1 = bytes32(uint256(0x5A171));
    bytes32 public constant SALT_2 = bytes32(uint256(0x5A172));
    string public constant PREDICTION_1 = "Bitcoin reaches new ATH before November.";
    string public constant PREDICTION_2 = "Ethereum L2 throughput exceeds 10,000 TPS.";

    function setUp() public {
        vm.warp(1_760_000_000);
        hindsight = new Hindsight();
    }

    function _commitment(address author, string memory text, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encode(author, text, salt));
    }

    function test_Commit_StoresAndEmits() public {
        bytes32 c = _commitment(alice, PREDICTION_1, SALT_1);
        uint64 revealAfter = uint64(block.timestamp + 30 days);

        vm.expectEmit(true, true, false, true);
        emit Hindsight.Committed(1, alice, c, revealAfter);

        vm.prank(alice);
        uint256 id = hindsight.commit(c, revealAfter);

        assertEq(id, 1);
        assertEq(hindsight.predictionCount(), 1);

        Hindsight.PredictionView memory v = hindsight.predictionOf(1);
        assertEq(v.id, 1);
        assertEq(v.author, alice);
        assertEq(v.commitment, c);
        assertEq(v.committedAt, block.timestamp);
        assertEq(v.committedBlock, block.number);
        assertEq(v.revealAfter, revealAfter);
        assertEq(v.revealedAt, 0);
        assertEq(v.right, 0);
        assertEq(v.wrong, 0);
        assertEq(v.status, 0); // Sealed
    }

    function test_Commit_RejectsEmptyCommitment() public {
        uint64 revealAfter = uint64(block.timestamp + 30 days);
        vm.prank(alice);
        vm.expectRevert(Hindsight.EmptyCommitment.selector);
        hindsight.commit(bytes32(0), revealAfter);
    }

    function test_Commit_BadRevealDate_Short_Long() public {
        bytes32 c = _commitment(alice, PREDICTION_1, SALT_1);

        // Too short (< 1 hour lead)
        uint64 tooShort = uint64(block.timestamp + 30 minutes);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Hindsight.BadRevealDate.selector, tooShort));
        hindsight.commit(c, tooShort);

        // Too long (> 5 years)
        uint64 tooLong = uint64(block.timestamp + 5 * 365 days + 1 days);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Hindsight.BadRevealDate.selector, tooLong));
        hindsight.commit(c, tooLong);
    }

    function test_Reveal_HappyPath_EmitsText() public {
        bytes32 c = _commitment(alice, PREDICTION_1, SALT_1);
        uint64 revealAfter = uint64(block.timestamp + 7 days);

        vm.prank(alice);
        uint256 id = hindsight.commit(c, revealAfter);

        // Warp to reveal period
        vm.warp(revealAfter + 1 hours);

        vm.expectEmit(true, true, false, true);
        emit Hindsight.Revealed(id, alice, PREDICTION_1);

        vm.prank(alice);
        hindsight.reveal(id, PREDICTION_1, SALT_1);

        Hindsight.PredictionView memory v = hindsight.predictionOf(id);
        assertEq(v.revealedAt, block.timestamp);
        assertEq(v.revealedBlock, block.number);
        assertEq(v.status, 2); // Revealed

        (uint32 committed, uint32 revealed) = hindsight.recordOf(alice);
        assertEq(committed, 1);
        assertEq(revealed, 1);
    }

    function test_Reveal_TooEarly() public {
        bytes32 c = _commitment(alice, PREDICTION_1, SALT_1);
        uint64 revealAfter = uint64(block.timestamp + 7 days);

        vm.prank(alice);
        uint256 id = hindsight.commit(c, revealAfter);

        // Warp before revealAfter
        vm.warp(revealAfter - 1);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Hindsight.TooEarly.selector, id, revealAfter));
        hindsight.reveal(id, PREDICTION_1, SALT_1);
    }

    function test_Reveal_AtWindowEdge_Allowed_OnePast_Closed() public {
        bytes32 c1 = _commitment(alice, PREDICTION_1, SALT_1);
        bytes32 c2 = _commitment(alice, PREDICTION_2, SALT_2);
        uint64 revealAfter = uint64(block.timestamp + 10 days);

        vm.startPrank(alice);
        uint256 id1 = hindsight.commit(c1, revealAfter);
        uint256 id2 = hindsight.commit(c2, revealAfter);
        vm.stopPrank();

        uint64 windowClose = revealAfter + 90 days;

        // Exactly at windowClose (allowed)
        vm.warp(windowClose);
        vm.prank(alice);
        hindsight.reveal(id1, PREDICTION_1, SALT_1);
        Hindsight.PredictionView memory v1 = hindsight.predictionOf(id1);
        assertEq(v1.status, 2); // Revealed

        // Exactly one second past windowClose (rejected)
        vm.warp(windowClose + 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Hindsight.WindowClosed.selector, id2, windowClose));
        hindsight.reveal(id2, PREDICTION_2, SALT_2);

        Hindsight.PredictionView memory v2 = hindsight.predictionOf(id2);
        assertEq(v2.status, 3); // Lapsed
    }

    function test_Reveal_WrongText_WrongSalt_WrongAuthor_BadReveal() public {
        bytes32 c = _commitment(alice, PREDICTION_1, SALT_1);
        uint64 revealAfter = uint64(block.timestamp + 2 days);

        vm.prank(alice);
        uint256 id = hindsight.commit(c, revealAfter);

        vm.warp(revealAfter + 10);

        // Wrong text
        vm.prank(alice);
        vm.expectRevert(Hindsight.BadReveal.selector);
        hindsight.reveal(id, "Slightly altered text", SALT_1);

        // Wrong salt
        vm.prank(alice);
        vm.expectRevert(Hindsight.BadReveal.selector);
        hindsight.reveal(id, PREDICTION_1, bytes32(uint256(0x999999)));
    }

    function test_Reveal_NotAuthor() public {
        bytes32 c = _commitment(alice, PREDICTION_1, SALT_1);
        uint64 revealAfter = uint64(block.timestamp + 2 days);

        vm.prank(alice);
        uint256 id = hindsight.commit(c, revealAfter);

        vm.warp(revealAfter + 10);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Hindsight.NotAuthor.selector, id, bob));
        hindsight.reveal(id, PREDICTION_1, SALT_1);
    }

    function test_Reveal_Twice() public {
        bytes32 c = _commitment(alice, PREDICTION_1, SALT_1);
        uint64 revealAfter = uint64(block.timestamp + 2 days);

        vm.prank(alice);
        uint256 id = hindsight.commit(c, revealAfter);

        vm.warp(revealAfter + 10);

        vm.prank(alice);
        hindsight.reveal(id, PREDICTION_1, SALT_1);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Hindsight.AlreadyRevealed.selector, id));
        hindsight.reveal(id, PREDICTION_1, SALT_1);
    }

    function test_Reveal_TextBounds() public {
        // Zero length text
        bytes32 c0 = _commitment(alice, "", SALT_1);
        uint64 revealAfter = uint64(block.timestamp + 2 days);

        vm.prank(alice);
        uint256 id0 = hindsight.commit(c0, revealAfter);
        vm.warp(revealAfter + 10);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Hindsight.BadText.selector, 0, 280));
        hindsight.reveal(id0, "", SALT_1);

        // Text exceeding 280 bytes
        bytes memory longBytes = new bytes(281);
        for (uint256 i = 0; i < 281; i++) {
            longBytes[i] = "a";
        }
        string memory longText = string(longBytes);
        bytes32 cLong = _commitment(alice, longText, SALT_1);
        uint64 revealAfterLong = uint64(block.timestamp + 2 days);

        vm.prank(alice);
        uint256 idLong = hindsight.commit(cLong, revealAfterLong);
        vm.warp(revealAfterLong + 10);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Hindsight.BadText.selector, 281, 280));
        hindsight.reveal(idLong, longText, SALT_1);
    }

    function test_CopiedCommitmentUseless() public {
        // Alice commits a prediction
        bytes32 c = _commitment(alice, PREDICTION_1, SALT_1);
        uint64 revealAfter = uint64(block.timestamp + 2 days);

        vm.prank(alice);
        hindsight.commit(c, revealAfter);

        // Bob sees the commitment c and copies it into his own prediction
        vm.prank(bob);
        uint256 bobId = hindsight.commit(c, revealAfter);

        vm.warp(revealAfter + 10);

        // Bob tries to reveal Alice's text with his address
        // The contract computes keccak256(abi.encode(bob, text, salt)), which will not equal c!
        vm.prank(bob);
        vm.expectRevert(Hindsight.BadReveal.selector);
        hindsight.reveal(bobId, PREDICTION_1, SALT_1);
    }

    function test_Judge_CountsRightAndWrong() public {
        bytes32 c = _commitment(alice, PREDICTION_1, SALT_1);
        uint64 revealAfter = uint64(block.timestamp + 2 days);

        vm.prank(alice);
        uint256 id = hindsight.commit(c, revealAfter);

        vm.warp(revealAfter + 10);
        vm.prank(alice);
        hindsight.reveal(id, PREDICTION_1, SALT_1);

        // Bob judges right (called it)
        vm.expectEmit(true, true, false, true);
        emit Hindsight.Judged(id, bob, true);
        vm.prank(bob);
        hindsight.judge(id, true);

        // Carol judges right
        vm.prank(carol);
        hindsight.judge(id, true);

        // Dave judges wrong (missed it)
        vm.prank(dave);
        hindsight.judge(id, false);

        Hindsight.PredictionView memory v = hindsight.predictionOf(id);
        assertEq(v.right, 2);
        assertEq(v.wrong, 1);
        assertTrue(hindsight.hasJudged(id, bob));
        assertTrue(hindsight.hasJudged(id, carol));
        assertTrue(hindsight.hasJudged(id, dave));
        assertFalse(hindsight.hasJudged(id, address(0x9999)));
    }

    function test_Judge_Author_Reverts() public {
        bytes32 c = _commitment(alice, PREDICTION_1, SALT_1);
        uint64 revealAfter = uint64(block.timestamp + 2 days);

        vm.prank(alice);
        uint256 id = hindsight.commit(c, revealAfter);

        vm.warp(revealAfter + 10);
        vm.prank(alice);
        hindsight.reveal(id, PREDICTION_1, SALT_1);

        // Alice cannot judge her own prediction
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Hindsight.AuthorCannotJudge.selector, id));
        hindsight.judge(id, true);
    }

    function test_Judge_Unrevealed_Reverts() public {
        bytes32 c = _commitment(alice, PREDICTION_1, SALT_1);
        uint64 revealAfter = uint64(block.timestamp + 2 days);

        vm.prank(alice);
        uint256 id = hindsight.commit(c, revealAfter);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Hindsight.NotRevealed.selector, id));
        hindsight.judge(id, true);
    }

    function test_Judge_Twice_Reverts() public {
        bytes32 c = _commitment(alice, PREDICTION_1, SALT_1);
        uint64 revealAfter = uint64(block.timestamp + 2 days);

        vm.prank(alice);
        uint256 id = hindsight.commit(c, revealAfter);

        vm.warp(revealAfter + 10);
        vm.prank(alice);
        hindsight.reveal(id, PREDICTION_1, SALT_1);

        vm.prank(bob);
        hindsight.judge(id, true);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Hindsight.AlreadyJudged.selector, id, bob));
        hindsight.judge(id, false);
    }

    function test_Status_AllFour() public {
        uint64 lead = 5 days;
        uint64 revealAfter = uint64(block.timestamp + lead);

        vm.startPrank(alice);
        uint256 idSealed = hindsight.commit(_commitment(alice, "P0", SALT_1), revealAfter);
        uint256 idRevealable = hindsight.commit(_commitment(alice, "P1", SALT_1), revealAfter);
        uint256 idRevealed = hindsight.commit(_commitment(alice, "P2", SALT_1), revealAfter);
        uint256 idLapsed = hindsight.commit(_commitment(alice, "P3", SALT_1), revealAfter);
        vm.stopPrank();

        // 1. Check Sealed
        assertEq(hindsight.predictionOf(idSealed).status, 0);

        // 2. Warp to Revealable window
        vm.warp(revealAfter + 1 days);
        assertEq(hindsight.predictionOf(idRevealable).status, 1);

        // 3. Reveal one
        vm.prank(alice);
        hindsight.reveal(idRevealed, "P2", SALT_1);
        assertEq(hindsight.predictionOf(idRevealed).status, 2);

        // 4. Warp past 90-day window
        vm.warp(revealAfter + 90 days + 1);
        assertEq(hindsight.predictionOf(idLapsed).status, 3); // Lapsed
        assertEq(hindsight.predictionOf(idRevealed).status, 2); // Still Revealed
    }

    function test_RecordOf_CountsRevealed() public {
        uint64 revealAfter = uint64(block.timestamp + 2 days);

        vm.startPrank(alice);
        uint256 id1 = hindsight.commit(_commitment(alice, "P1", SALT_1), revealAfter);
        hindsight.commit(_commitment(alice, "P2", SALT_2), revealAfter);
        hindsight.commit(_commitment(alice, "P3", bytes32(uint256(3))), revealAfter);

        vm.warp(revealAfter + 10);
        hindsight.reveal(id1, "P1", SALT_1);
        vm.stopPrank();

        (uint32 committed, uint32 revealed) = hindsight.recordOf(alice);
        assertEq(committed, 3);
        assertEq(revealed, 1);

        Hindsight.PredictionView[] memory byAlice = hindsight.predictionsBy(alice, 0, 10);
        assertEq(byAlice.length, 3);
        // Newest first
        assertEq(byAlice[0].id, 3);
        assertEq(byAlice[1].id, 2);
        assertEq(byAlice[2].id, 1);
    }

    function test_Latest_Filters_Pagination() public {
        uint64 revealAfter = uint64(block.timestamp + 2 days);

        vm.startPrank(alice);
        uint256 id1 = hindsight.commit(_commitment(alice, "P1", SALT_1), revealAfter);
        uint256 id2 = hindsight.commit(_commitment(alice, "P2", SALT_2), revealAfter);
        uint256 id3 = hindsight.commit(_commitment(alice, "P3", bytes32(uint256(3))), revealAfter);

        vm.warp(revealAfter + 10);
        hindsight.reveal(id1, "P1", SALT_1);
        hindsight.reveal(id3, "P3", bytes32(uint256(3)));
        vm.stopPrank();

        // Status filter 2 (Revealed)
        Hindsight.PredictionView[] memory revOnly = hindsight.latest(0, 10, 2);
        assertEq(revOnly.length, 2);
        assertEq(revOnly[0].id, id3); // Newest first
        assertEq(revOnly[1].id, id1);

        // Status filter 1 (Revealable)
        Hindsight.PredictionView[] memory revable = hindsight.latest(0, 10, 1);
        assertEq(revable.length, 1);
        assertEq(revable[0].id, id2);

        // Status filter 255 (All)
        Hindsight.PredictionView[] memory allViews = hindsight.latest(0, 10, 255);
        assertEq(allViews.length, 3);
        assertEq(allViews[0].id, 3);
        assertEq(allViews[1].id, 2);
        assertEq(allViews[2].id, 1);
    }

    function testFuzz_CommitmentRoundTrip(bytes32 salt, uint8 textSeed) public {
        vm.assume(salt != bytes32(0));
        string memory sample = textSeed % 2 == 0 ? PREDICTION_1 : PREDICTION_2;

        bytes32 c = _commitment(alice, sample, salt);
        uint64 revealAfter = uint64(block.timestamp + 10 days);

        vm.prank(alice);
        uint256 id = hindsight.commit(c, revealAfter);

        vm.warp(revealAfter + 1 hours);

        vm.prank(alice);
        hindsight.reveal(id, sample, salt);

        Hindsight.PredictionView memory v = hindsight.predictionOf(id);
        assertEq(v.status, 2); // Revealed
    }

    function test_NoBalance() public {
        assertEq(address(hindsight).balance, 0);
        (bool ok,) = address(hindsight).call{value: 1 ether}("");
        assertFalse(ok);
    }

    function test_GasCeilings() public {
        bytes32 c = _commitment(alice, PREDICTION_1, SALT_1);
        uint64 revealAfter = uint64(block.timestamp + 5 days);

        vm.prank(alice);
        uint256 gasStart = gasleft();
        uint256 id = hindsight.commit(c, revealAfter);
        uint256 gasCommit = gasStart - gasleft();
        assertLt(gasCommit, 160_000);

        vm.warp(revealAfter + 10);

        vm.prank(alice);
        gasStart = gasleft();
        hindsight.reveal(id, PREDICTION_1, SALT_1);
        uint256 gasReveal = gasStart - gasleft();
        assertLt(gasReveal, 80_000);

        vm.prank(bob);
        gasStart = gasleft();
        hindsight.judge(id, true);
        uint256 gasJudge = gasStart - gasleft();
        assertLt(gasJudge, 65_000);
    }
}
