import { createRoomResponse, route } from "../../../lib/game-server.ts";
export function POST(request: Request) { return route(() => createRoomResponse(request)); }
