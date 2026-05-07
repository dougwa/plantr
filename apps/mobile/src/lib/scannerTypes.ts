import * as SecureStore from "expo-secure-store";

export const ALL_BARCODE_TYPES = [
  "qr",
  "aztec",
  "datamatrix",
  "pdf417",
  "code128",
  "code39",
  "code93",
  "codabar",
  "ean13",
  "ean8",
  "itf14",
  "upc_a",
  "upc_e",
] as const;

export type BarcodeType = (typeof ALL_BARCODE_TYPES)[number];

export const BARCODE_LABELS: Record<BarcodeType, string> = {
  qr: "QR Code",
  aztec: "Aztec",
  datamatrix: "Data Matrix",
  pdf417: "PDF417",
  code128: "Code 128",
  code39: "Code 39",
  code93: "Code 93",
  codabar: "Codabar",
  ean13: "EAN-13",
  ean8: "EAN-8",
  itf14: "ITF-14",
  upc_a: "UPC-A",
  upc_e: "UPC-E",
};

export const BARCODE_IMAGES: Record<BarcodeType, string> = {
  qr: require('../assets/QRCode.webp'),
  aztec: require('../assets/Aztec.webp'),
  datamatrix: require('../assets/DataMatrix.webp'),
  pdf417: require('../assets/PDF417.webp'),
  code128: require('../assets/Code128.webp'),
  code39: require('../assets/Code39.webp'),
  code93: require('../assets/Code93.webp'),
  codabar: require('../assets/Codabar.webp'),
  ean13: require('../assets/EAN-13.png'),
  ean8: require('../assets/EAN-8.png'),
  itf14: require('../assets/ITF-14.png'),
  upc_a: require('../assets/UPC-A.png'),
  upc_e: require('../assets/UPC-E.png'),
}


const STORAGE_KEY = "plantr.scannerTypes";
const KNOWN_SET = new Set<string>(ALL_BARCODE_TYPES);

export async function loadEnabledBarcodeTypes(): Promise<BarcodeType[]> {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    if (!raw) return [...ALL_BARCODE_TYPES];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...ALL_BARCODE_TYPES];
    const filtered = parsed.filter(
      (x): x is BarcodeType => typeof x === "string" && KNOWN_SET.has(x),
    );
    return filtered.length > 0 ? filtered : [...ALL_BARCODE_TYPES];
  } catch {
    return [...ALL_BARCODE_TYPES];
  }
}

export async function saveEnabledBarcodeTypes(
  types: BarcodeType[],
): Promise<void> {
  try {
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(types));
  } catch {
    // best-effort
  }
}
