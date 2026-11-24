// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title DailyFest — a food festival for Agent ID holders
/// @notice Built for the Binance Wallet Agent ID Hackathon (BNB Chain).
///
/// Every UTC day has one featured dish from a fixed 14-dish menu baked into
/// this contract. Each Agent ID holder may free-mint (gas only) that day's
/// dish as a soulbound NFT — one per wallet per day. Minting on consecutive
/// days builds a streak; milestone "Feast badges" (Bronze at a 3-day best
/// streak, Silver at 7, Gold at 14) are claimable off the wallet's BEST
/// streak, so one missed day never erases a badge already earned. Holders
/// collect the dish set on their "shelf" (which of the 14 dishes they own).
///
/// HOW AGENT ID IS USED:
/// Minting is gated on holding an Agent ID (the soulbound SPACE ID Agent ID
/// ERC-721, registry 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F): the contract
/// checks registry balanceOf(sender) > 0 on every mintDish(). Because an
/// Agent ID is non-transferable and one-per-person, streaks, shelves and
/// badges — all soulbound — are effectively non-transferable too.
///
/// SAFETY / COMPLIANCE NOTES FOR REVIEWERS:
/// - This contract handles NO money: there are no payable functions and it
///   never custodies funds. Minting is free; users pay only BSC gas.
/// - There is NO owner, NO admin, NO pause, NO upgradeability, and NO way to
///   change the registry address or the menu after deployment.
/// - All tokens are SOULBOUND: every transfer function reverts. Approvals
///   revert too — there is nothing to approve and nothing that can move.
/// - Agent ID is never used to look up other people's wallets by name: the
///   contract only checks balanceOf(address) for the caller's own address.

interface IAgentID {
    function balanceOf(address owner) external view returns (uint256);
}

contract DailyFest {
    // ----- ERC-721 metadata -----
    string public constant name = "Daily Fest";
    string public constant symbol = "FEST";

    uint256 public constant MENU_SIZE = 14;
    uint256 public constant SECONDS_PER_DAY = 86400;

    // Token kinds: 0 = dish of the day; 1/2/3 = Bronze/Silver/Gold Feast badge.
    uint8 public constant KIND_DISH = 0;

    string internal constant _IMAGE_BASE =
        "https://cdn.jsdelivr.net/gh/Velt89/dailyfest@main/frontend/public/dishes/";

    /// @notice SPACE ID Agent ID registry on BNB Chain (immutable).
    IAgentID public immutable agentIdRegistry;

    // ----- Menu (fixed at construction, exact order) -----
    string[] private _dishNames;
    string[] private _dishSlugs;

    // ----- Tokens -----
    struct TokenMeta {
        uint8 kind; // 0 = dish, 1..3 = badge tier
        uint8 dishIndex; // dish tokens only
        uint256 mintDay; // UTC day number (timestamp / 86400)
        uint256 streakAtMint; // dish: streak after this mint; badge: best streak
    }

    TokenMeta[] private _tokens;
    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;

    // ----- Per-holder festival state -----
    mapping(address => bool) private _everMinted;
    mapping(address => uint256) private _lastMintDay;
    mapping(address => uint256) private _currentStreak;
    mapping(address => uint256) private _bestStreak;
    mapping(address => uint256) private _lifetimeDays;
    mapping(address => mapping(uint8 => bool)) private _hasDish;
    mapping(address => uint256) private _distinctDishes;
    mapping(address => mapping(uint8 => bool)) private _badgeClaimed;
    address[] private _festgoers;
    mapping(address => bool) private _isFestgoer;

    // ----- Events -----
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event DishMinted(address indexed user, uint256 indexed day, uint8 dishIndex, uint256 streak, uint256 tokenId);
    event BadgeClaimed(address indexed user, uint8 tier, uint256 tokenId);

    constructor(address registry) {
        require(registry != address(0), "registry is zero address");
        agentIdRegistry = IAgentID(registry);

        _dishNames = [
            "Rendang", "Sate Ayam", "Nasi Goreng", "Bakso", "Martabak Manis",
            "Ramen", "Sushi", "Tacos", "Pizza", "Burger",
            "Dim Sum", "BBQ Ribs", "Croissant", "Es Krim"
        ];
        _dishSlugs = [
            "rendang", "sate-ayam", "nasi-goreng", "bakso", "martabak-manis",
            "ramen", "sushi", "tacos", "pizza", "burger",
            "dim-sum", "bbq-ribs", "croissant", "es-krim"
        ];
    }

    // ----- Agent ID gate -----

    /// @notice True if `account` holds at least one Agent ID.
    function hasAgentId(address account) public view returns (bool) {
        return agentIdRegistry.balanceOf(account) > 0;
    }

    // ----- Menu / dish of the day -----

    function _today() internal view returns (uint256) {
        return block.timestamp / SECONDS_PER_DAY;
    }

    /// @notice Dish index (0-13) served on a given UTC day number.
    function dishIndexOfDay(uint256 day) public pure returns (uint256) {
        return day % MENU_SIZE;
    }

    /// @notice Dish served on a given UTC day number.
    function dishOfDay(uint256 day) external view returns (uint8 index, string memory dishName) {
        index = uint8(dishIndexOfDay(day));
        dishName = _dishNames[index];
    }

    /// @notice Today's dish and the current UTC day number.
    function todaysDish() external view returns (uint8 index, string memory dishName, uint256 day) {
        day = _today();
        index = uint8(dishIndexOfDay(day));
        dishName = _dishNames[index];
    }

    function dishName(uint8 index) external view returns (string memory) {
        require(index < MENU_SIZE, "invalid dish index");
        return _dishNames[index];
    }

    function dishSlug(uint8 index) external view returns (string memory) {
        require(index < MENU_SIZE, "invalid dish index");
        return _dishSlugs[index];
    }

    /// @notice Best-streak requirement for a badge tier (1=Bronze 3, 2=Silver 7, 3=Gold 14).
    function badgeRequirement(uint8 tier) public pure returns (uint256) {
        if (tier == 1) return 3;
        if (tier == 2) return 7;
        if (tier == 3) return 14;
        revert("invalid tier");
    }

    function badgeName(uint8 tier) public pure returns (string memory) {
        if (tier == 1) return "Bronze";
        if (tier == 2) return "Silver";
        if (tier == 3) return "Gold";
        revert("invalid tier");
    }

    // ----- Minting -----

    /// @notice Free-mint today's dish. One per wallet per UTC day, Agent ID
    /// holders only. Consecutive days build the streak.
    function mintDish() external returns (uint256 tokenId) {
        require(hasAgentId(msg.sender), "sender holds no Agent ID");
        uint256 today = _today();
        require(!(_everMinted[msg.sender] && _lastMintDay[msg.sender] == today), "Already minted today");

        uint256 streak;
        if (_everMinted[msg.sender] && today > 0 && _lastMintDay[msg.sender] == today - 1) {
            streak = _currentStreak[msg.sender] + 1;
        } else {
            streak = 1;
        }
        _currentStreak[msg.sender] = streak;
        if (streak > _bestStreak[msg.sender]) _bestStreak[msg.sender] = streak;
        _lifetimeDays[msg.sender] += 1;
        _lastMintDay[msg.sender] = today;

        uint8 dish = uint8(dishIndexOfDay(today));
        tokenId = _tokens.length;
        _tokens.push(TokenMeta({kind: KIND_DISH, dishIndex: dish, mintDay: today, streakAtMint: streak}));
        _owners[tokenId] = msg.sender;
        _balances[msg.sender] += 1;

        if (!_hasDish[msg.sender][dish]) {
            _hasDish[msg.sender][dish] = true;
            _distinctDishes[msg.sender] += 1;
        }
        if (!_everMinted[msg.sender]) {
            _everMinted[msg.sender] = true;
            if (!_isFestgoer[msg.sender]) {
                _isFestgoer[msg.sender] = true;
                _festgoers.push(msg.sender);
            }
        }

        emit Transfer(address(0), msg.sender, tokenId);
        emit DishMinted(msg.sender, today, dish, streak, tokenId);
    }

    /// @notice Claim a Feast badge your BEST streak qualifies you for.
    /// tier: 1 = Bronze (3), 2 = Silver (7), 3 = Gold (14). Once per tier.
    function claimBadge(uint8 tier) external returns (uint256 tokenId) {
        require(tier >= 1 && tier <= 3, "invalid tier");
        require(_bestStreak[msg.sender] >= badgeRequirement(tier), "streak too short for this badge");
        require(!_badgeClaimed[msg.sender][tier], "badge already claimed");
        _badgeClaimed[msg.sender][tier] = true;

        tokenId = _tokens.length;
        _tokens.push(
            TokenMeta({kind: tier, dishIndex: 0, mintDay: _today(), streakAtMint: _bestStreak[msg.sender]})
        );
        _owners[tokenId] = msg.sender;
        _balances[msg.sender] += 1;

        emit Transfer(address(0), msg.sender, tokenId);
        emit BadgeClaimed(msg.sender, tier, tokenId);
    }

    // ----- Views -----

    /// @return current current streak (consecutive days, as of the last mint)
    /// @return best best streak ever reached
    /// @return lifetime total days minted (lifetime)
    function streakOf(address user) external view returns (uint256 current, uint256 best, uint256 lifetime) {
        return (_currentStreak[user], _bestStreak[user], _lifetimeDays[user]);
    }

    /// @notice True if `user` could mintDish() right now (holder + not yet today).
    function canMintToday(address user) external view returns (bool) {
        if (!hasAgentId(user)) return false;
        return !(_everMinted[user] && _lastMintDay[user] == _today());
    }

    /// @notice UTC day number of the user's last mint (0 if never).
    function lastMintDayOf(address user) external view returns (uint256) {
        return _everMinted[user] ? _lastMintDay[user] : 0;
    }

    function badgeClaimed(address user, uint8 tier) external view returns (bool) {
        return _badgeClaimed[user][tier];
    }

    function tokenKind(uint256 tokenId) external view returns (uint8) {
        require(tokenId < _tokens.length, "token does not exist");
        return _tokens[tokenId].kind;
    }

    /// @notice Dish index of a dish token. Reverts for badge tokens.
    function tokenDish(uint256 tokenId) external view returns (uint8) {
        require(tokenId < _tokens.length, "token does not exist");
        require(_tokens[tokenId].kind == KIND_DISH, "not a dish token");
        return _tokens[tokenId].dishIndex;
    }

    function hasDish(address user, uint8 dishIndex) external view returns (bool) {
        return _hasDish[user][dishIndex];
    }

    /// @notice How many of the 14 dishes the user has collected (0-14).
    function distinctDishesOf(address user) external view returns (uint256) {
        return _distinctDishes[user];
    }

    function totalMinted() external view returns (uint256) {
        return _tokens.length;
    }

    function uniqueFestgoers() external view returns (uint256) {
        return _festgoers.length;
    }

    function festgoersCount() external view returns (uint256) {
        return _festgoers.length;
    }

    /// @notice Paginated festgoer addresses (limit clamped to 100).
    function getFestgoers(uint256 offset, uint256 limit) external view returns (address[] memory page) {
        if (limit > 100) limit = 100;
        if (offset >= _festgoers.length || limit == 0) return new address[](0);
        uint256 end = offset + limit;
        if (end > _festgoers.length) end = _festgoers.length;
        page = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            page[i - offset] = _festgoers[i];
        }
    }

    // ----- ERC-721 (soulbound) -----

    function balanceOf(address owner) external view returns (uint256) {
        require(owner != address(0), "zero address");
        return _balances[owner];
    }

    function ownerOf(uint256 tokenId) public view returns (address) {
        address owner = _owners[tokenId];
        require(owner != address(0), "token does not exist");
        return owner;
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        require(tokenId < _tokens.length, "token does not exist");
        TokenMeta memory t = _tokens[tokenId];
        string memory json = t.kind == KIND_DISH ? _dishJSON(t) : _badgeJSON(t);
        return string(abi.encodePacked("data:application/json;base64,", _base64Encode(bytes(json))));
    }

    function _dishJSON(TokenMeta memory t) internal view returns (string memory) {
        string memory dName = _dishNames[t.dishIndex];
        string memory head = string(
            abi.encodePacked(
                '{"name":"Daily Fest \xe2\x80\x94 ', dName,
                '","description":"A soulbound dish from Daily Fest, the food festival for Agent ID holders on BNB Chain. One free dish every day; streaks earn Feast badges. No token, no payments, no returns promised.",',
                '"image":"', _IMAGE_BASE, _dishSlugs[t.dishIndex], '.svg","attributes":['
            )
        );
        string memory tail = string(
            abi.encodePacked(
                '{"trait_type":"Kind","value":"Dish"},',
                '{"trait_type":"Dish","value":"', dName, '"},',
                '{"trait_type":"Day","value":', _toString(t.mintDay), '},',
                '{"trait_type":"Streak at mint","value":', _toString(t.streakAtMint), "}]}"
            )
        );
        return string(abi.encodePacked(head, tail));
    }

    function _badgeJSON(TokenMeta memory t) internal view returns (string memory) {
        string memory bName = badgeName(t.kind);
        string memory slug = t.kind == 1 ? "badge-bronze" : t.kind == 2 ? "badge-silver" : "badge-gold";
        string memory req = _toString(badgeRequirement(t.kind));
        string memory head = string(
            abi.encodePacked(
                '{"name":"Daily Fest \xe2\x80\x94 ', bName, ' Feast Badge",',
                '"description":"A soulbound Feast badge from Daily Fest, earned with a ', req,
                '-day best streak. No token, no payments, no returns promised.",',
                '"image":"', _IMAGE_BASE, slug, '.svg","attributes":['
            )
        );
        string memory tail = string(
            abi.encodePacked(
                '{"trait_type":"Kind","value":"Badge"},',
                '{"trait_type":"Tier","value":"', bName, '"},',
                '{"trait_type":"Required streak","value":', req, "}]}"
            )
        );
        return string(abi.encodePacked(head, tail));
    }

    // Soulbound: all transfers and approvals revert, always.
    function transferFrom(address, address, uint256) external pure {
        revert("DailyFest: soulbound - transfers disabled");
    }

    function safeTransferFrom(address, address, uint256) external pure {
        revert("DailyFest: soulbound - transfers disabled");
    }

    function safeTransferFrom(address, address, uint256, bytes calldata) external pure {
        revert("DailyFest: soulbound - transfers disabled");
    }

    function approve(address, uint256) external pure {
        revert("DailyFest: soulbound - approvals disabled");
    }

    function setApprovalForAll(address, bool) external pure {
        revert("DailyFest: soulbound - approvals disabled");
    }

    function getApproved(uint256 tokenId) external view returns (address) {
        require(tokenId < _tokens.length, "token does not exist");
        return address(0);
    }

    function isApprovedForAll(address, address) external pure returns (bool) {
        return false;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return
            interfaceId == 0x01ffc9a7 || // ERC165
            interfaceId == 0x80ac58cd || // ERC721
            interfaceId == 0x5b5e139f; // ERC721Metadata
    }

    // ----- Internals -----

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    function _base64Encode(bytes memory data) internal pure returns (string memory) {
        bytes memory table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        return _base64EncodeSimple(data, table);
    }

    function _base64EncodeSimple(bytes memory data, bytes memory table) internal pure returns (string memory) {
        uint256 len = data.length;
        if (len == 0) return "";
        bytes memory result = new bytes(4 * ((len + 2) / 3));
        uint256 i;
        uint256 j;
        while (i < len) {
            uint256 a = uint8(data[i]);
            uint256 b = i + 1 < len ? uint8(data[i + 1]) : 0;
            uint256 c = i + 2 < len ? uint8(data[i + 2]) : 0;
            result[j] = table[(a >> 2) & 0x3f];
            result[j + 1] = table[((a & 0x03) << 4) | (b >> 4)];
            result[j + 2] = i + 1 < len ? table[((b & 0x0f) << 2) | (c >> 6)] : bytes1("=");
            result[j + 3] = i + 2 < len ? table[c & 0x3f] : bytes1("=");
            i += 3;
            j += 4;
        }
        return string(result);
    }
}
