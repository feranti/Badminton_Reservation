import { type NextRequest } from "next/server";
import { requirePlayer } from "@/lib/session";

// Image d'un QR code (/api/qr?chemin=…), réservée aux joueurs connectés.
export async function GET(request: NextRequest) {
  const { db } = await requirePlayer();
  const path = request.nextUrl.searchParams.get("chemin") ?? "";
  if (!path || path.length > 300) return new Response("QR code introuvable", { status: 404 });

  const [image] = await db<{ content_type: string; data: Buffer }>`
    select content_type, data from public.qr_images where path = ${path}`;
  if (!image) return new Response("QR code introuvable", { status: 404 });

  return new Response(new Uint8Array(image.data), {
    headers: {
      "Content-Type": image.content_type,
      "Content-Length": String(image.data.length),
      // Le navigateur ne doit jamais deviner un autre type (une page web déguisée en image).
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      // Le chemin change à chaque nouvelle image : la même adresse renvoie toujours le même fichier.
      "Cache-Control": "private, max-age=86400, immutable",
    },
  });
}
