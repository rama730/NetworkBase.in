/**
 * Avatar Service - Optimized
 * Shows immediate preview, uploads in background
 */

/**
 * Compress and resize image to 400x400 JPEG
 */
export async function compressAvatar(file: File): Promise<Blob> {
    return new Promise((resolve, reject) => {
        const img = new Image()
        const objectUrl = URL.createObjectURL(file)
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')

        if (!ctx) {
            reject(new Error('Note not supported'))
            return
        }

        img.onload = () => {
            URL.revokeObjectURL(objectUrl)
            if (img.width <= 0 || img.height <= 0 || img.width * img.height > 16_000_000) {
                reject(new Error('Image dimensions exceed the 16 megapixel limit'))
                return
            }
            const size = 400
            const minDim = Math.min(img.width, img.height)
            const sx = (img.width - minDim) / 2
            const sy = (img.height - minDim) / 2

            canvas.width = size
            canvas.height = size

            ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size)

            canvas.toBlob(
                (blob) => {
                    if (blob) resolve(blob)
                    else reject(new Error('Compression failed'))
                },
                'image/jpeg',
                0.85
            )
        }

        img.onerror = () => {
            URL.revokeObjectURL(objectUrl)
            reject(new Error('Couldn’t load image'))
        }
        img.src = objectUrl
    })
}
