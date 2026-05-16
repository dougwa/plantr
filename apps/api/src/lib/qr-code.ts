import { z } from "zod";

// Accept any code that's letters, digits, or common ID separators. Avoids
// "/" so by-qr URL routing stays unambiguous.
export const qrCodeSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9._-]+$/);
