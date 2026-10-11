'use strict';

(() => {
  const overlap = (a,b) => {
    const area=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
    const union=a.width*a.height+b.width*b.height-area;
    return union>0 ? area/union : 0;
  };
  const normalizedBox = (box,image) => {
    if (!image || !box || ![image.width,image.height,box.x,box.y,box.width,box.height].every(Number.isFinite) || image.width<=0 || image.height<=0 || box.width<=0 || box.height<=0) return null;
    return {x:box.x/image.width,y:box.y/image.height,width:box.width/image.width,height:box.height/image.height};
  };
  const createTracker = rules => {
    let candidate=null,lastCapture=null,contextKey=null;
    const reset = () => {candidate=null;lastCapture=null;contextKey=null;};
    const step = ({faces=[],image,captured_at_ms,received_at_ms,context=''}) => {
      const result = (status,reason,extra={}) => ({status,reason,samples:0,required_samples:rules.min_samples,profile_id:null,span_ms:0,new_confirmation:false,...extra});
      if (!Number.isFinite(captured_at_ms) || !Number.isFinite(received_at_ms) || received_at_ms<captured_at_ms || received_at_ms-captured_at_ms>rules.max_response_age_ms) {
        candidate=null;
        return result('discarded','stale_response');
      }
      if (lastCapture!==null && captured_at_ms<=lastCapture) {
        candidate=null;
        return result('discarded','out_of_order');
      }
      lastCapture=captured_at_ms;
      if (contextKey!==context) candidate=null;
      contextKey=context;
      if (faces.length!==1 || faces[0].status!=='matched' || !faces[0].profile?.id) {
        candidate=null;
        return result('unconfirmed',faces.length>1 ? 'multiple_faces' : !faces.length ? 'no_face' : faces[0].status);
      }
      const face=faces[0],box=normalizedBox(face.box,image);
      if (!box) {candidate=null;return result('unconfirmed','invalid_box');}
      let reason='agreement';
      if (candidate && candidate.id!==face.profile.id) {candidate=null;reason='identity_changed';}
      if (candidate && captured_at_ms-candidate.times.at(-1)>rules.max_gap_ms) {candidate=null;reason='capture_gap';}
      if (candidate && overlap(candidate.box,box)<rules.min_overlap) {candidate=null;reason='face_moved';}
      if (!candidate) candidate={id:face.profile.id,box,times:[],confirmed:false};
      candidate.times=candidate.times.filter(at=>captured_at_ms-at<=rules.window_ms);
      candidate.times.push(captured_at_ms);
      candidate.box=box;
      const span=captured_at_ms-candidate.times[0];
      const confirmed=candidate.times.length>=rules.min_samples && span>=rules.min_span_ms;
      const newConfirmation=confirmed && !candidate.confirmed;
      candidate.confirmed=confirmed;
      return result(confirmed ? 'confirmed' : 'pending',reason,{
        samples:candidate.times.length,profile_id:confirmed ? candidate.id : null,span_ms:span,
        new_confirmation:newConfirmation,confirmation_latency_ms:newConfirmation ? received_at_ms-candidate.times[0] : null});
    };
    return Object.freeze({reset,step});
  };
  const utilities=Object.freeze({createTracker,overlap,normalizedBox});
  if (typeof module!=='undefined' && module.exports) module.exports=utilities;
  else globalThis.AegisDeveloperTemporal=utilities;
})();
