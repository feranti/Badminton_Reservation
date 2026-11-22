// Images des QR codes, gardées dans la base (table qr_images, 0011).
// Mêmes limites que l'ancien stockage de Supabase : 10 Mo, PNG, JPEG, WebP, HEIC/HEIF ou PDF.
export const QR_MAX_BYTES = 10 * 1024 * 1024;

export const QR_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
} as const;
export type QrType = keyof typeof QR_TYPES;

// Le type est lu dans les premiers octets du fichier, pas dans ce que déclare le navigateur :
// un fichier d'un autre genre (page web, SVG…) est refusé, quel que soit son nom.
export function sniffQrType(data: Uint8Array): QrType | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...data.subarray(start, end));
  if (data.length < 12) return null;
  if (data[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(0, 5) === "%PDF-") return "application/pdf";
  if (ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (["heic", "heix", "hevc", "hevx", "heim", "heis"].includes(brand)) return "image/heic";
    if (["mif1", "msf1"].includes(brand)) return "image/heif";
  }
  return null;
}
