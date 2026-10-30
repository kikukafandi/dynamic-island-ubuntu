// Accent colour from album art, iPhone-style: favour vivid pixels, then make sure the result
// is bright and saturated enough to read on the black island.

function rgbToHsv(r, g, b) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d) {
        if (max === r)
            h = ((g - b) / d) % 6;
        else if (max === g)
            h = (b - r) / d + 2;
        else
            h = (r - g) / d + 4;
        h /= 6;
        if (h < 0)
            h += 1;
    }
    return [h, max ? d / max : 0, max / 255];
}

function hsvToRgb(h, s, v) {
    const i = Math.floor(h * 6), f = h * 6 - i;
    const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
    return [r, g, b].map(c => Math.round(c * 255));
}

// pixels: flat RGB(A) bytes; channels: 3 or 4; returns [r, g, b] or null for an empty/grey image
export function accentFromPixels(pixels, channels) {
    let r = 0, g = 0, b = 0, total = 0;
    for (let i = 0; i + 2 < pixels.length; i += channels) {
        const [, s, v] = rgbToHsv(pixels[i], pixels[i + 1], pixels[i + 2]);
        const weight = s * v * s; // vivid pixels dominate, greys and near-blacks barely count
        r += pixels[i] * weight;
        g += pixels[i + 1] * weight;
        b += pixels[i + 2] * weight;
        total += weight;
    }
    if (total < 0.5) // essentially greyscale art: let the caller fall back to the default accent
        return null;
    const [h, s, v] = rgbToHsv(r / total, g / total, b / total);
    return hsvToRgb(h, Math.max(s, 0.55), Math.max(v, 0.85));
}
