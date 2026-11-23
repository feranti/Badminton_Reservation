import { type NextRequest } from "next/server";
import { attempt, type Db } from "@/lib/db";
import { QR_MAX_BYTES, sniffQrType } from "@/lib/qr-image";
import { requirePlayer } from "@/lib/session";

// Image d'un QR code (/api/qr?chemin=…), réservée aux joueurs connectés.
export async function GET(request: NextRequest) {
  const { db } = await requirePlayer();
  const path = request.nextUrl.searchParams.get("chemin") ?? "";
  if (!path || path.length > 300) return new Response("QR code introuvable", { status: 404 });

  let [image] = await db<{ content_type: string; data: Buffer }>`
    select content_type, data from public.qr_images where path = ${path}`;

  // Image envoyée avant 0011 : encore dans le stockage de Supabase, recopiée dans la base au
  // premier affichage. Seulement pour un QR code enregistré, au chemin de la forme habituelle.
  if (!image) {
    const data = await fromSupabaseStorage(db, path);
    if (!data) return new Response("QR code introuvable", { status: 404 });
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

const OLD_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/\d{1,2}-\d{1,15}\.[a-z]{2,4}$/;

// Lit une ancienne image dans le stockage de Supabase avec la clé secrète du serveur
// (SUPABASE_SECRET_KEY). À supprimer quand la base aura quitté Supabase.
async function fromSupabaseStorage(db: Db, path: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key || !OLD_PATH.test(path)) return null;
  const [known] = await db`select 1 from public.booking_qr_codes where qr_path = ${path}`;
  if (!known) return null;
  const res = await fetch(`${url}/storage/v1/object/qr-codes/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  }).catch(() => null);
  if (!res?.ok || Number(res.headers.get("content-length") ?? 0) > QR_MAX_BYTES) return null;
  const data = Buffer.from(await res.arrayBuffer());
  return data.length > 0 && data.length <= QR_MAX_BYTES ? data : null;
}
