// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

/// @title Hindsight
/// @notice Commit to a prediction now. Reveal it later.
/// @dev Authors publish a cryptographic commitment before an event occurs and reveal it
/// within a 90-day window after a specified reveal date. Wallets can subsequently judge
/// the outcome as either "Called it" or "Missed it".
///
/// What this contract deliberately cannot do:
/// - Cannot recover lost predictions: if the author loses the text or salt, it can never be revealed.
/// - Cannot force subjective truth: judgements reflect individual wallet opinions, not oracle feeds.
/// - Cannot be paused, upgraded, or cancelled: completely autonomous with no owner or admin.
/// - Cannot accept funds: holds zero native tokens.
contract Hindsight {
    uint64 public constant REVEAL_WINDOW = 90 days;
    uint64 public constant MIN_LEAD = 1 hours;
    uint64 public constant MAX_LEAD = 5 * 365 days;
    uint256 public constant MAX_TEXT_BYTES = 280;
    uint256 public constant MAX_PAGE = 50;

    struct Prediction {
        address author;        // 20 bytes ┐ slot 1
        uint64 committedAt;    //  8 bytes │
        uint32 committedBlock; //  4 bytes ┘
        bytes32 commitment;    // 32 bytes   slot 2
        uint64 revealAfter;    //  8 bytes ┐ slot 3
        uint64 revealedAt;     //  8 bytes │ 0 until revealed
        uint32 revealedBlock;  //  4 bytes │
        uint32 right;          //  4 bytes │ "called it" judgements
        uint32 wrong;          //  4 bytes ┘ "missed it" judgements
    }

    struct PredictionView {
        uint256 id;
        address author;
        bytes32 commitment;
        uint64 committedAt;
        uint32 committedBlock;
        uint64 revealAfter;
        uint64 revealedAt;
        uint32 revealedBlock;
        uint32 right;
        uint32 wrong;
        uint8 status; // 0 Sealed, 1 Revealable, 2 Revealed, 3 Lapsed
    }

    mapping(uint256 => Prediction) private _predictions;
    mapping(uint256 => mapping(address => bool)) private _judged;
    mapping(address => uint256[]) private _by;
    mapping(address => uint32) private _revealedCount;
    uint256 public predictionCount;

    event Committed(uint256 indexed id, address indexed author, bytes32 commitment, uint64 revealAfter);
    event Revealed(uint256 indexed id, address indexed author, string text);
    event Judged(uint256 indexed id, address indexed judge, bool right);

    error EmptyCommitment();
    error BadRevealDate(uint64 revealAfter);
    error NoSuchPrediction(uint256 id);
    error NotAuthor(uint256 id, address caller);
    error AlreadyRevealed(uint256 id);
    error TooEarly(uint256 id, uint64 revealAfter);
    error WindowClosed(uint256 id, uint64 closedAt);
    error BadText(uint256 length, uint256 max);
    error BadReveal();
    error AuthorCannotJudge(uint256 id);
    error NotRevealed(uint256 id);
    error AlreadyJudged(uint256 id, address judge);

    /// @notice Commit a prediction hash with a future reveal date.
    /// @param commitment keccak256(abi.encode(msg.sender, text, salt))
    /// @param revealAfter Earliest timestamp at which author may reveal the prediction
    function commit(bytes32 commitment, uint64 revealAfter) external returns (uint256 id) {
        if (commitment == bytes32(0)) revert EmptyCommitment();
        if (revealAfter < block.timestamp + MIN_LEAD || revealAfter > block.timestamp + MAX_LEAD) {
            revert BadRevealDate(revealAfter);
        }

        id = ++predictionCount;
        _predictions[id] = Prediction({
            author: msg.sender,
            committedAt: uint64(block.timestamp),
            committedBlock: uint32(block.number),
            commitment: commitment,
            revealAfter: revealAfter,
            revealedAt: 0,
            revealedBlock: 0,
            right: 0,
            wrong: 0
        });

        _by[msg.sender].push(id);
        emit Committed(id, msg.sender, commitment, revealAfter);
    }

    /// @notice Reveal the text and salt of a committed prediction.
    /// @param id The prediction identifier
    /// @param text The exact UTF-8 prediction string (1..280 bytes)
    /// @param salt The 32-byte secret salt used during commitment
    function reveal(uint256 id, string calldata text, bytes32 salt) external {
        Prediction storage p = _predictions[id];
        if (p.committedAt == 0) revert NoSuchPrediction(id);
        if (msg.sender != p.author) revert NotAuthor(id, msg.sender);
        if (p.revealedAt != 0) revert AlreadyRevealed(id);
        if (block.timestamp < p.revealAfter) revert TooEarly(id, p.revealAfter);

        uint64 windowClose = p.revealAfter + REVEAL_WINDOW;
        if (block.timestamp > windowClose) revert WindowClosed(id, windowClose);

        uint256 textLen = bytes(text).length;
        if (textLen == 0 || textLen > MAX_TEXT_BYTES) revert BadText(textLen, MAX_TEXT_BYTES);

        bytes32 expected = keccak256(abi.encode(msg.sender, text, salt));
        if (expected != p.commitment) revert BadReveal();

        p.revealedAt = uint64(block.timestamp);
        p.revealedBlock = uint32(block.number);
        _revealedCount[msg.sender]++;

        emit Revealed(id, msg.sender, text);
    }

    /// @notice Cast a verdict on a revealed prediction.
    /// @param id The prediction identifier
    /// @param right True if called it, False if missed it
    function judge(uint256 id, bool right) external {
        Prediction storage p = _predictions[id];
        if (p.committedAt == 0) revert NoSuchPrediction(id);
        if (p.revealedAt == 0) revert NotRevealed(id);
        if (msg.sender == p.author) revert AuthorCannotJudge(id);
        if (_judged[id][msg.sender]) revert AlreadyJudged(id, msg.sender);

        _judged[id][msg.sender] = true;
        if (right) {
            p.right++;
        } else {
            p.wrong++;
        }

        emit Judged(id, msg.sender, right);
    }

    /// @notice Returns the status of a prediction.
    /// 0 Sealed, 1 Revealable, 2 Revealed, 3 Lapsed
    function _computeStatus(Prediction storage p) internal view returns (uint8) {
        if (p.revealedAt != 0) return 2; // Revealed
        if (block.timestamp < p.revealAfter) return 0; // Sealed
        if (block.timestamp <= p.revealAfter + REVEAL_WINDOW) return 1; // Revealable
        return 3; // Lapsed
    }

    /// @notice Retrieves full view of a single prediction by ID.
    function predictionOf(uint256 id) external view returns (PredictionView memory) {
        Prediction storage p = _predictions[id];
        if (p.committedAt == 0) {
            return PredictionView({
                id: 0,
                author: address(0),
                commitment: bytes32(0),
                committedAt: 0,
                committedBlock: 0,
                revealAfter: 0,
                revealedAt: 0,
                revealedBlock: 0,
                right: 0,
                wrong: 0,
                status: 0
            });
        }

        return PredictionView({
            id: id,
            author: p.author,
            commitment: p.commitment,
            committedAt: p.committedAt,
            committedBlock: p.committedBlock,
            revealAfter: p.revealAfter,
            revealedAt: p.revealedAt,
            revealedBlock: p.revealedBlock,
            right: p.right,
            wrong: p.wrong,
            status: _computeStatus(p)
        });
    }

    /// @notice Returns counts of committed and revealed predictions for an author.
    /// Lapsed count is derived off-chain by evaluating open vs expired predictions.
    function recordOf(address author) external view returns (uint32 committed, uint32 revealed) {
        committed = uint32(_by[author].length);
        revealed = _revealedCount[author];
    }

    /// @notice Check if a specific wallet has judged a prediction.
    function hasJudged(uint256 id, address who) external view returns (bool) {
        return _judged[id][who];
    }

    /// @notice Returns paginated predictions by author, newest first.
    function predictionsBy(
        address author,
        uint256 offset,
        uint256 count
    ) external view returns (PredictionView[] memory) {
        uint256 total = _by[author].length;
        if (offset >= total) return new PredictionView[](0);

        if (count > MAX_PAGE) count = MAX_PAGE;
        if (offset + count > total) {
            count = total - offset;
        }

        PredictionView[] memory result = new PredictionView[](count);
        for (uint256 i = 0; i < count; i++) {
            uint256 id = _by[author][total - 1 - offset - i];
            Prediction storage p = _predictions[id];
            result[i] = PredictionView({
                id: id,
                author: p.author,
                commitment: p.commitment,
                committedAt: p.committedAt,
                committedBlock: p.committedBlock,
                revealAfter: p.revealAfter,
                revealedAt: p.revealedAt,
                revealedBlock: p.revealedBlock,
                right: p.right,
                wrong: p.wrong,
                status: _computeStatus(p)
            });
        }

        return result;
    }

    /// @notice Queries latest predictions newest first, with optional status filter.
    /// Scans at most MAX_PAGE * 4 (200) entries to bound execution gas.
    /// @param offset Number of matched predictions to skip
    /// @param count Maximum number of predictions to return (clamped to MAX_PAGE)
    /// @param statusFilter 0 Sealed, 1 Revealable, 2 Revealed, 3 Lapsed, 255 All
    function latest(
        uint256 offset,
        uint256 count,
        uint8 statusFilter
    ) external view returns (PredictionView[] memory) {
        uint256 total = predictionCount;
        if (total == 0) return new PredictionView[](0);
        if (count > MAX_PAGE) count = MAX_PAGE;

        uint256 maxScan = MAX_PAGE * 4;
        PredictionView[] memory buffer = new PredictionView[](count);
        uint256 matched = 0;
        uint256 skipped = 0;
        uint256 scanned = 0;

        for (uint256 currentId = total; currentId > 0 && matched < count && scanned < maxScan; currentId--) {
            scanned++;
            Prediction storage p = _predictions[currentId];
            uint8 st = _computeStatus(p);

            if (statusFilter == 255 || st == statusFilter) {
                if (skipped < offset) {
                    skipped++;
                } else {
                    buffer[matched] = PredictionView({
                        id: currentId,
                        author: p.author,
                        commitment: p.commitment,
                        committedAt: p.committedAt,
                        committedBlock: p.committedBlock,
                        revealAfter: p.revealAfter,
                        revealedAt: p.revealedAt,
                        revealedBlock: p.revealedBlock,
                        right: p.right,
                        wrong: p.wrong,
                        status: st
                    });
                    matched++;
                }
            }
        }

        if (matched == count) return buffer;

        // Truncate buffer to actual matched count
        PredictionView[] memory trimmed = new PredictionView[](matched);
        for (uint256 i = 0; i < matched; i++) {
            trimmed[i] = buffer[i];
        }
        return trimmed;
    }
}
