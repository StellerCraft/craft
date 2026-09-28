/** Test helper: encode a version byte + 32-byte payload as a strkey (CRC-16/XMODEM little-endian, base32). */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function encodeStrKey(version: number, payload: Uint8Array): string {
    const data = [version, ...payload];
    let crc = 0;
    for (const byte of data) {
        crc ^= byte << 8;
        for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
    }
    const bytes = [...data, crc & 0xff, (crc >> 8) & 0xff];
    let out = '';
    let buffer = 0;
    let bits = 0;
    for (const byte of bytes) {
        buffer = (buffer << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            out += ALPHABET[(buffer >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    return bits > 0 ? out + ALPHABET[(buffer << (5 - bits)) & 31] : out;
}

/** Encode 32 bytes as a valid Soroban contract address (version byte 0x10). */
export const encodeContractAddress = (payload: Uint8Array): string => encodeStrKey(0x10, payload);
