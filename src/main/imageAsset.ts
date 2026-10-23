import path from 'node:path'
import { AppError } from './errors'

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024

/** 所有图片入口共用相同的扩展名、文件头与体积校验。 */
export function validateImage(buffer: Buffer, name: string, declaredMime?: string): { extension: string; mime: string } {
  const original = path.extname(name).toLowerCase()
  const extension = original === '.jpeg' ? '.jpg' : original
  const types: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }
  const mime = types[extension]
  if (!mime || (declaredMime !== undefined && mime !== declaredMime)) {
    throw new AppError('UNSUPPORTED_IMAGE', '图片扩展名或 MIME 类型不受支持')
  }
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new AppError('IMAGE_TOO_LARGE', '单张图片须为 1 字节至 25MB')
  const valid = extension === '.png'
    ? buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    : extension === '.jpg'
      ? buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
      : extension === '.gif'
        ? ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))
        : buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  if (!valid) throw new AppError('INVALID_IMAGE', '图片内容与扩展名不匹配')
  return { extension, mime }
}
