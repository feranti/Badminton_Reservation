import { NextResponse, type NextRequest } from "next/server";

// L'image partagée est normalement reçue par le service worker (public/sw.js).
// S'il n'était pas encore installé, on revient sur /partager pour demander de recommencer.
export function POST(request: NextRequest) {
  return NextResponse.redirect(new URL("/partager?erreur=1", request.url), 303);
}
