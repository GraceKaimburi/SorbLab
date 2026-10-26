// zip.js: builds a plain zip file in the browser with no libraries, so several input files download as one.
// It stores the files uncompressed, which is fine for small text files.

const TABLE = (() => { // a lookup table that makes the checksum fast
  const t = new Uint32Array(256); // 256 entries, one per possible byte
  for (let n = 0; n < 256; n++) { // fill each entry
    let c = n; // start from the byte value
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; // the standard CRC 32 bit mixing steps
    t[n] = c >>> 0; // store as an unsigned number
  }
  return t; // the finished table
})();

function crc32(bytes) { // the checksum zip files use to detect damage
  let c = 0xffffffff; // starting value required by the format
  for (const b of bytes) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8); // mix in each byte
  return (c ^ 0xffffffff) >>> 0; // final inversion, as an unsigned number
}

function u16(n) { return [n & 255, (n >>> 8) & 255]; } // a number as two bytes, least significant first, the order zip uses
function u32(n) { return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]; } // a number as four bytes

export function makeZip(files) { // files is a list of {name, content}, returns a Blob
  const enc = new TextEncoder(); // turns text into bytes
  const chunks = []; // the body of the zip, piece by piece
  const central = []; // the directory at the end of the zip
  let offset = 0; // running position in the file
  for (const f of files) { // add each file
    const name = enc.encode(f.name); // the file name as bytes
    const data = enc.encode(f.content); // the file content as bytes
    const crc = crc32(data); // checksum of the content
    const head = Uint8Array.from([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)]); // local file header: signature, version, flags, no compression, fixed date, sizes
    chunks.push(head, name, data); // write header, name and content
    central.push(Uint8Array.from([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name); // matching directory entry pointing back to the header
    offset += head.length + name.length + data.length; // move the position past what was written
  }
  const dirSize = central.reduce((a, c) => a + c.length, 0); // total size of the directory
  const end = Uint8Array.from([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(dirSize), ...u32(offset), ...u16(0)]); // end of directory record
  return new Blob([...chunks, ...central, end], { type: 'application/zip' }); // the finished zip as a downloadable object
}
