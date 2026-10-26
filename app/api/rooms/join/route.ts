import { joinRoomResponse, route } from "../../../../lib/game-server.ts";
export function POST(request: Request) { return route(() => joinRoomResponse(request)); }
