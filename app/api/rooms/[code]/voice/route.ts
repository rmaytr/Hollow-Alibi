import {voiceResponse,route} from '../../../../../lib/game-server.ts';
export function POST(request:Request,context:{params:Promise<{code:string}>}){
  return route(async()=>voiceResponse(request,(await context.params).code));
}
