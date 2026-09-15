// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// @dev STOP-prefixed immutable bytecode: calling the pointer cannot execute data.
contract CarveBytecodeChunk {
    constructor(bytes memory data) {
        bytes memory runtime = bytes.concat(hex"00", data);
        assembly ("memory-safe") { return(add(runtime, 32), mload(runtime)) }
    }
}

/// @notice Permissionless, immutable content manifests over registry-created chunks.
/// @dev Encoding describes bytes; this contract does not decompress or sanitize HTML.
contract CarveContentRegistry {
    uint8 public constant VERSION = 1;
    uint256 public constant MAX_CHUNK_BYTES = 20_480;
    uint256 public constant MAX_CHUNKS = 128;

    struct Chunk { bytes32 dataHash; uint32 byteLength; }
    struct Content {
        uint8 version;
        string mimeType;
        string encoding;
        uint256 byteLength;
        address creator;
        address[] pointers;
        bytes32[] chunkHashes;
    }
    mapping(address => Chunk) public chunks;
    mapping(bytes32 => address) public pointerForHash;
    mapping(bytes32 => Content) private contents;

    error InvalidChunk();
    error InvalidManifest();
    error UnknownContent();
    error ContentAlreadyRegistered();
    event ChunkWritten(address indexed pointer, bytes32 indexed chunkHash, uint256 byteLength);
    event ContentRegistered(bytes32 indexed root, address indexed creator, string mimeType, string encoding, uint256 byteLength);

    function writeChunk(bytes calldata data) external returns (address pointer, bytes32 chunkHash) {
        if (data.length == 0 || data.length > MAX_CHUNK_BYTES) revert InvalidChunk();
        chunkHash = keccak256(data);
        pointer = pointerForHash[chunkHash];
        if (pointer != address(0)) return (pointer, chunkHash);
        pointer = address(new CarveBytecodeChunk(data));
        chunks[pointer] = Chunk(chunkHash, uint32(data.length));
        pointerForHash[chunkHash] = pointer;
        emit ChunkWritten(pointer, chunkHash, data.length);
    }

    /// @notice Registration is finalization. No update, delete, or owner functions exist.
    function registerContent(
        string calldata mimeType,
        string calldata encoding,
        uint256 byteLength,
        address[] calldata pointers,
        bytes32[] calldata chunkHashes
    ) external returns (bytes32 root) {
        uint256 count = pointers.length;
        if (bytes(mimeType).length == 0 || bytes(mimeType).length > 96 || count == 0 || count > MAX_CHUNKS
            || count != chunkHashes.length || byteLength == 0) revert InvalidManifest();
        bytes32 enc = keccak256(bytes(encoding));
        if (enc != keccak256("identity") && enc != keccak256("gzip")) revert InvalidManifest();
        uint256 length;
        for (uint256 i; i < count; ++i) {
            Chunk memory chunk = chunks[pointers[i]];
            if (chunk.byteLength == 0 || chunk.dataHash != chunkHashes[i]
                || pointers[i].code.length != uint256(chunk.byteLength) + 1) revert InvalidManifest();
            length += chunk.byteLength;
        }
        if (length != byteLength) revert InvalidManifest();
        root = keccak256(abi.encode(VERSION, mimeType, encoding, byteLength, pointers, chunkHashes));
        if (contents[root].version != 0) revert ContentAlreadyRegistered();
        contents[root] = Content(VERSION, mimeType, encoding, byteLength, msg.sender, pointers, chunkHashes);
        emit ContentRegistered(root, msg.sender, mimeType, encoding, byteLength);
    }

    function exists(bytes32 root) external view returns (bool) { return contents[root].version != 0; }

    function getContent(bytes32 root) external view returns (
        uint8 version, string memory mimeType, string memory encoding, uint256 byteLength,
        address creator, address[] memory pointers, bytes32[] memory chunkHashes
    ) {
        Content storage c = contents[root];
        if (c.version == 0) revert UnknownContent();
        return (c.version, c.mimeType, c.encoding, c.byteLength, c.creator, c.pointers, c.chunkHashes);
    }

    function readChunk(address pointer) public view returns (bytes memory data) {
        uint256 length = chunks[pointer].byteLength;
        if (length == 0) revert InvalidChunk();
        data = new bytes(length);
        assembly ("memory-safe") { extcodecopy(pointer, add(data, 32), 1, length) }
    }

    /// @dev For large content, readChunk avoids RPC return-size limits on this aggregate view.
    function read(bytes32 root) external view returns (bytes memory data) {
        Content storage c = contents[root];
        if (c.version == 0) revert UnknownContent();
        data = new bytes(c.byteLength);
        uint256 offset;
        for (uint256 i; i < c.pointers.length; ++i) {
            address pointer = c.pointers[i];
            uint256 length = chunks[pointer].byteLength;
            assembly ("memory-safe") { extcodecopy(pointer, add(add(data, 32), offset), 1, length) }
            offset += length;
        }
    }
}
