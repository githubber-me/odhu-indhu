import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const { GET, POST, PUT, DELETE, PATCH } = auth.handler();
