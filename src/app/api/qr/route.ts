import { type NextRequest } from "next/server";
import { attempt } from "@/lib/db";
import { QR_MAX_BYTES, sniffQrType } from "@/lib/qr-image";
import { requirePlayer } from "@/lib/session";

// Image d'un QR code (/api/qr?chemin=…), réservée aux joueurs connectés.
export async function GET(request: NextRequest) {
  const { db, supabase } = await requirePlayer();
  const path = request.nextUrl.searchParams.get("chemin") ?? "";
  if (!path || path.length > 300) return new Response("QR code introuvable", { status: 404 });

  let [image] = await db<{ content_type: string; data: Buffer }>`
    select content_type, data from public.qr_images where path = ${path}`;

  // Image envoyée avant 0011 : encore dans le stockage de Supabase, recopiée dans la base au
  // premier affichage.
  if (!image) {
    const { data: blob } = await supabase.storage.from("qr-codes").download(path);
    if (!blob || blob.size > QR_MAX_BYTES) return new Response("QR code introuvable", { status: 404 });
    const data = Buffer.from(await blob.arrayBuffer());
    const type = sniffQrType(data);
    if (!type) return new Response("QR code illisible", { status: 415 });
    const { error } = await attempt(
      db`insert into public.qr_images (path, content_type, data) values (${path}, ${type}, ${data}) on conflict (path) do nothing`,
    );
    if (error) console.error("[QR code] copie dans la base impossible", error);
    image = { content_type: type, data };
  }

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
