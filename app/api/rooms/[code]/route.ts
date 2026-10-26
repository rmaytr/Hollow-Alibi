import { readRoomResponse, route } from "../../../../lib/game-server.ts";
export function GET(request: Request, context: { params: Promise<{ code: string }> }) {
  return route(async () => readRoomResponse(request, (await context.params).code));
}
