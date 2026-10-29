"use client";

export type PreparedImageUpload = {
    blob: Blob;
    contentType: string;
    originalSize: number;
    optimizedSize: number;
    optimized: boolean;
};

type PrepareProjectImageOptions = {
    maxBytes: number;
    size: number;
    previewSize: number;
    zoom: number;
    offsetX: number;
    offsetY: number;
    outputType?: "image/jpeg" | "image/webp";
};

const MAX_SOURCE_IMAGE_PIXELS = 16_000_000;

function assertImagePixelLimit(image: Pick<HTMLImageElement, "naturalWidth" | "naturalHeight">) {
    if (
        image.naturalWidth <= 0
        || image.naturalHeight <= 0
        || image.naturalWidth * image.naturalHeight > MAX_SOURCE_IMAGE_PIXELS
    ) {
        throw new Error("Image dimensions exceed the 16 megapixel limit.");
    }
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        const objectUrl = URL.createObjectURL(file);
        image.onload = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(image);
        };
        image.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error("Couldn’t read image."));
        };
        image.src = objectUrl;
    });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error("Couldn’t optimize image."));
                return;
            }
            resolve(blob);
        }, type, quality);
    });
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function getCoverDrawState(image: HTMLImageElement, size: number, previewSize: number, zoom: number, offsetX: number, offsetY: number) {
    const safeSize = Math.max(1, size);
    const safePreviewSize = Math.max(1, previewSize);
    const safeZoom = clamp(zoom, 1, 4);
    const basePreviewScale = Math.max(
        safePreviewSize / Math.max(1, image.naturalWidth),
        safePreviewSize / Math.max(1, image.naturalHeight),
    );
    const previewWidth = image.naturalWidth * basePreviewScale * safeZoom;
    const previewHeight = image.naturalHeight * basePreviewScale * safeZoom;
    const maxPreviewOffsetX = Math.max(0, (previewWidth - safePreviewSize) / 2);
    const maxPreviewOffsetY = Math.max(0, (previewHeight - safePreviewSize) / 2);
    const clampedPreviewOffsetX = clamp(offsetX, -maxPreviewOffsetX, maxPreviewOffsetX);
    const clampedPreviewOffsetY = clamp(offsetY, -maxPreviewOffsetY, maxPreviewOffsetY);
    const outputOffsetX = (clampedPreviewOffsetX / safePreviewSize) * safeSize;
    const outputOffsetY = (clampedPreviewOffsetY / safePreviewSize) * safeSize;
    const baseOutputScale = Math.max(
        safeSize / Math.max(1, image.naturalWidth),
        safeSize / Math.max(1, image.naturalHeight),
    );
    const drawWidth = image.naturalWidth * baseOutputScale * safeZoom;
    const drawHeight = image.naturalHeight * baseOutputScale * safeZoom;

    return {
        drawX: (safeSize - drawWidth) / 2 + outputOffsetX,
        drawY: (safeSize - drawHeight) / 2 + outputOffsetY,
        drawWidth,
        drawHeight,
    };
}

export async function prepareProjectImageForUpload(
    file: File,
    options: PrepareProjectImageOptions,
): Promise<PreparedImageUpload> {
    // Preserve animated GIF frames by bypassing 2D canvas rasterization
    const isGif = file.type === "image/gif" || file.name.toLowerCase().endsWith(".gif");
    if (isGif) {
        if (file.size > options.maxBytes) {
            throw new Error(`GIF avatar must be under ${Math.round(options.maxBytes / (1024 * 1024))}MB.`);
        }
        const gifImage = await loadImage(file);
        assertImagePixelLimit(gifImage);
        return {
            blob: file.type === "image/gif" ? file : new Blob([file], { type: "image/gif" }),
            contentType: "image/gif",
            originalSize: file.size,
            optimizedSize: file.size,
            optimized: false,
        };
    }

    const image = await loadImage(file);
    assertImagePixelLimit(image);
    const outputType = options.outputType ?? "image/jpeg";
    const sizeSteps = [1, 0.85, 0.7, 0.55].map((scale) => Math.max(1, Math.round(options.size * scale)));
    const qualitySteps = [0.9, 0.82, 0.74, 0.66, 0.58];

    for (const size of sizeSteps) {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext("2d");
        if (!context) {
            throw new Error("Image adjustment is not supported in this browser.");
        }

        const drawState = getCoverDrawState(
            image,
            size,
            options.previewSize,
            options.zoom,
            options.offsetX,
            options.offsetY,
        );
        context.fillStyle = "#0a0a0a";
        context.fillRect(0, 0, size, size);
        context.drawImage(
            image,
            drawState.drawX,
            drawState.drawY,
            drawState.drawWidth,
            drawState.drawHeight,
        );

        for (const quality of qualitySteps) {
            const blob = await canvasToBlob(canvas, outputType, quality);
            if (blob.size <= options.maxBytes) {
                return {
                    blob,
                    contentType: outputType,
                    originalSize: file.size,
                    optimizedSize: blob.size,
                    optimized: blob.size !== file.size || outputType !== file.type,
                };
            }
        }
    }

    throw new Error("Image is too large to upload. Choose a smaller image.");
}
