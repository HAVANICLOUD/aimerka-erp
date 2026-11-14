import {readState} from '../../../lib/store';
export const dynamic='force-dynamic';
/** Sites enforces this site's existing private audience and service token boundary.
 * No caller-supplied state, dates or prices are accepted. This endpoint only runs
 * the same deterministic maintenance as normal state reads; exposes no records. */
export async function POST(request:Request){
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return Response.json({error:'Origen inválido.'},{status:403});
 try{const data=await readState('v43');return Response.json({ok:true,revision:data.revision,pending:(data.state.campaignPriceRestorations||[]).filter((r:any)=>r.status==='pending').length,restored:(data.state.campaignPriceRestorations||[]).filter((r:any)=>r.status==='restored').length},{headers:{'Cache-Control':'no-store'}});}
 catch{return Response.json({ok:false,error:'No se pudo completar el cierre de campañas.'},{status:503});}
}
