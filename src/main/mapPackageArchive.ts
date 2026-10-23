import { createInflateRaw } from 'node:zlib'
import { setImmediate } from 'node:timers/promises'
import { strFromU8 } from 'fflate'
import { isAllowedPackageEntry, MapPackageError, MAP_PACKAGE_LIMITS } from '@shared/mapPackage'

interface Entry {
  name: string
  offset: number
  compressedSize: number
  size: number
  method: number
  crc: number
}

function invalid(message = '工程包无法解压，ZIP 结构无效'): never {
  throw new MapPackageError('MAP_PACKAGE_INVALID', message)
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0)
  return value >>> 0
})

/** 解压前检查目录和本地头，拒绝重复名称、别名、ZIP64、加密及越界条目。 */
function readEntries(bytes: Buffer): Entry[] {
  let end = bytes.length - 22
  const lower = Math.max(0, end - 65535)
  while (end >= lower && (bytes.readUInt32LE(end) !== 0x06054b50 || end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length)) end -= 1
  if (end < lower) invalid()
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) invalid('工程包不支持分卷 ZIP')
  const count = bytes.readUInt16LE(end + 10)
  if (bytes.readUInt16LE(end + 8) !== count || !count) invalid()
  if (count > MAP_PACKAGE_LIMITS.entries) throw new MapPackageError('MAP_PACKAGE_TOO_LARGE', '工程包文件数量过多')
  const directory = bytes.readUInt32LE(end + 16)
  if (directory + bytes.readUInt32LE(end + 12) !== end) invalid()
  const entries: Entry[] = []
  const names = new Set<string>()
  let cursor = directory
  let localCursor = 0
  let totalSize = 0
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) invalid()
    const flags = bytes.readUInt16LE(cursor + 8)
    const method = bytes.readUInt16LE(cursor + 10)
    const crc = bytes.readUInt32LE(cursor + 16)
    const compressedSize = bytes.readUInt32LE(cursor + 20)
    const size = bytes.readUInt32LE(cursor + 24)
    const nameLength = bytes.readUInt16LE(cursor + 28)
    const extraLength = bytes.readUInt16LE(cursor + 30)
    const commentLength = bytes.readUInt16LE(cursor + 32)
    const offset = bytes.readUInt32LE(cursor + 42)
    // 自有工程包由 zipSync 产生，无数据描述符；不接受需要猜测尺寸的变体。
    if ((flags & ~0x800) || (method !== 0 && method !== 8) || bytes.readUInt16LE(cursor + 34)) invalid('工程包使用了不支持的 ZIP 特性')
    if (cursor + 46 + nameLength + extraLength + commentLength > end) invalid()
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength)
    const name = strFromU8(nameBytes, !(flags & 0x800))
    if (!isAllowedPackageEntry(name)) throw new MapPackageError('MAP_PACKAGE_PATH_INVALID', '工程包含有非法路径：' + name)
    const canonical = name.toLowerCase()
    if (names.has(canonical)) invalid('工程包含有重复或大小写冲突的路径：' + name)
    names.add(canonical)
    totalSize += size
    if (size > MAP_PACKAGE_LIMITS.unpackedBytes || totalSize > MAP_PACKAGE_LIMITS.unpackedBytes) {
      throw new MapPackageError('MAP_PACKAGE_TOO_LARGE', '工程包解压后超过 150MB')
    }
    if (name.startsWith('assets/') && size > MAP_PACKAGE_LIMITS.imageBytes) {
      throw new MapPackageError('MAP_PACKAGE_TOO_LARGE', '工程包单张图片超过 25MB')
    }
    if ((name === 'manifest.json' || name === 'map.json') && size > MAP_PACKAGE_LIMITS.jsonBytes) {
      throw new MapPackageError('MAP_PACKAGE_TOO_LARGE', '工程包 JSON 文件过大')
    }
    if (offset !== localCursor || offset + 30 > directory || bytes.readUInt32LE(offset) !== 0x04034b50) invalid()
    const localNameLength = bytes.readUInt16LE(offset + 26)
    const dataOffset = offset + 30 + localNameLength + bytes.readUInt16LE(offset + 28)
    if (dataOffset + compressedSize > directory ||
        flags !== bytes.readUInt16LE(offset + 6) || method !== bytes.readUInt16LE(offset + 8) ||
        crc !== bytes.readUInt32LE(offset + 14) || compressedSize !== bytes.readUInt32LE(offset + 18) ||
        size !== bytes.readUInt32LE(offset + 22) ||
        !nameBytes.equals(bytes.subarray(offset + 30, offset + 30 + localNameLength))) invalid()
    if (method === 0 && size !== compressedSize) invalid()
    entries.push({ name, offset: dataOffset, compressedSize, size, method, crc })
    localCursor = dataOffset + compressedSize
    cursor += 46 + nameLength + extraLength + commentLength
  }
  if (cursor !== end || localCursor !== directory) invalid()
  return entries
}

/** 使用 zlib 线程池逐块解压；实际输出超出声明或总预算时立即销毁流。 */
export async function readMapPackageArchive(bytes: Buffer): Promise<Record<string, Uint8Array>> {
  if (!bytes.length || bytes.length > MAP_PACKAGE_LIMITS.compressedBytes) {
    throw new MapPackageError('MAP_PACKAGE_TOO_LARGE', '工程包为空或超过 100MB')
  }
  if (bytes.length < 22) invalid()
  const entries = readEntries(bytes)
  const result: Record<string, Uint8Array> = Object.create(null)
  let total = 0
  for (const entry of entries) {
    const compressed = bytes.subarray(entry.offset, entry.offset + entry.compressedSize)
    const chunks: Buffer[] = []
    let size = 0
    let crc = 0xffffffff
    const append = (chunk: Buffer) => {
      size += chunk.length
      total += chunk.length
      if (size > entry.size || total > MAP_PACKAGE_LIMITS.unpackedBytes) {
        throw new MapPackageError('MAP_PACKAGE_TOO_LARGE', '工程包实际解压内容超出声明或大小限制')
      }
      for (const byte of chunk) crc = crcTable[(crc ^ byte) & 255]! ^ (crc >>> 8)
      chunks.push(chunk)
    }
    if (entry.method === 0) {
      for (let offset = 0; offset < compressed.length; offset += 16384) {
        append(compressed.subarray(offset, offset + 16384))
        await setImmediate()
      }
    } else {
      const inflater = createInflateRaw({ chunkSize: 16384 })
      try {
        inflater.end(compressed)
        for await (const chunk of inflater) append(chunk as Buffer)
        if (inflater.bytesWritten !== entry.compressedSize) invalid('工程包含有多余的压缩数据')
      } catch (error) {
        if (error instanceof MapPackageError) throw error
        invalid('工程包无法解压，文件可能已损坏')
      } finally {
        inflater.destroy()
      }
    }
    if (size !== entry.size || ((crc ^ 0xffffffff) >>> 0) !== entry.crc) invalid('工程包条目大小或 CRC 校验不一致：' + entry.name)
    result[entry.name] = Buffer.concat(chunks, size)
  }
  return result
}
