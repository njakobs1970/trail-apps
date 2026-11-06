// Library v2 (evidence 2026.11): extra exercises + tags for every move.
// Tags: pattern (movement pattern, progression is stored per pattern), diff 1-3, pnf (PNF-capable hold).
// New moves reuse the stick-figure pose of the closest existing move (poseFrom).
(function(root){
const PS='Do the left side, then the right. The timer runs each side separately with a 5-second switch.';
const X=(o)=>Object.assign({icon:'🦵',sides:true,secs:40,kind:'',equip:[],focus:['trail','lower'],order:3,prop:'',perSide:o.sides===false?'':PS},o);
const NEW=[
X({id:'kneel-soleus',name:'Kneeling Soleus Rock',area:['calves'],poseFrom:'kneel-hip-flexor',order:3,cue:'Half-kneel, front heel down. Rock the front knee forward past the toes and hold where the low calf pulls.',setup:'Kneel on one knee with the other foot flat in front, close to your body.',steps:['Put your hands on the front knee.','Lean your weight forward so the knee travels past the toes.','Keep the front heel pressed down.','Hold at the first strong pull in the lower calf and Achilles.'],feel:'Deep in the lower calf and Achilles (soleus).',mistakes:'Letting the heel lift, or the knee collapse inward.',easier:'Move the front foot further forward.',harder:'Rest a dumbbell on the front knee.'}),
X({id:'band-ankle',name:'Banded Ankle Mobilisation',area:['calves','feet'],poseFrom:'knee-wall',equip:['strap'],swap:'kneel-soleus',order:1,cue:'Band pulls the ankle back; drive the knee forward over the toes and hold.',setup:'Loop a band low around the front of your ankle, anchored behind you. Half-kneel or stand in a split stance.',steps:['Step forward so the band is tight.','Drive the front knee forward over the second toe.','Keep the heel down.','Hold at end range and breathe.'],feel:'A stretch at the back of the ankle with the front of the ankle feeling free.',mistakes:'Heel lifting, or a pinch at the front of the ankle.',easier:'Use a lighter band.',harder:'Hold longer and lean further.'}),
X({id:'calf-ecc-bent',name:'Bent-knee Eccentric Calf Drop',area:['calves'],kind:'loaded',poseFrom:'deficit-calf',equip:['step'],swap:'floor-calf-ecc',order:2,cue:'On a step, knee slightly bent: rise on two feet, lower slowly on one to the bottom stretch.',setup:'Stand on the edge of a step, heels hanging off, a hand on the wall. Bend the knees about 20°.',steps:['Rise up on both feet.','Shift to one foot.','Lower slowly (3–5 s) until the heel is below the step.','Pause in the bottom stretch, then rise on both feet again.'],feel:'Lower calf working and stretching.',mistakes:'Dropping fast, or bouncing at the bottom.',easier:'Do it on the floor.',harder:'Hold a dumbbell in the same-side hand.'}),
X({id:'kot-weighted',name:'Weighted Knee-over-Toe Hold',area:['calves'],kind:'loaded',poseFrom:'knee-wall',order:3,cue:'Half-kneel with a weight on the front knee, knee forward over toes, heel down.',setup:'Half-kneel with the front foot close to you. Rest a dumbbell or kettlebell on the front thigh just above the knee.',steps:['Let the weight push the knee forward over the toes.','Keep the heel down.','Hold, breathing slowly.','Ease back before switching.'],feel:'A strong lower-calf stretch under load.',mistakes:'Heel lifting.',easier:'No weight; push with your hands.',harder:'Heavier weight.'}),
X({id:'half-split',name:'Half Split',area:['hamstrings'],poseFrom:'lizard',equip:['block'],swap:'half-split-bw',order:3,cue:'Kneel, front leg straight, hips back over the back knee, fold with a flat back.',setup:'Kneel on one knee, front leg straight with the heel down and toes up. Hands on blocks either side.',steps:['Shift your hips back over the back knee.','Keep the front knee straight but soft.','Hinge forward with a long spine.','Hold at a firm stretch.'],feel:'Back of the front thigh.',mistakes:'Rounding the back to reach further.',easier:'Bend the front knee slightly.',harder:'Lower your chest closer to the thigh.'}),
X({id:'half-split-bw',name:'Half Split (hands on shin)',area:['hamstrings'],swapOnly:true,poseFrom:'lizard',order:3,cue:'Kneel, front leg straight, hips back, hands on the shin, fold with a flat back.',setup:'Kneel on one knee, front leg straight, hands resting on the shin.',steps:['Shift your hips back.','Keep the front leg straight.','Hinge forward from the hips.','Hold.'],feel:'Back of the front thigh.',mistakes:'Rounding the back.',easier:'Bend the front knee.',harder:'Walk the hands to the floor.'}),
X({id:'heel-chair-ham',name:'Heel-on-Chair Hamstring',area:['hamstrings'],poseFrom:'standing-ham',equip:['chair'],swap:'standing-ham',order:1,cue:'Heel on a chair, leg straight, hinge forward from the hips with a long spine.',setup:'Stand facing a chair. Put one heel on the seat, leg straight, toes up.',steps:['Square your hips to the chair.','Hinge forward from the hips with a flat back.','Stop at a firm stretch.','Hold and breathe.'],feel:'Back of the raised thigh.',mistakes:'Rounding the back, or locking the knee hard.',easier:'Use a lower step.',harder:'Point the toes toward you.'}),
X({id:'nordic-assist',name:'Assisted Nordic Lowering',area:['hamstrings'],kind:'loaded',sides:false,perSide:'',poseFrom:'kneel-lift',order:4,icon:'🏋️',cue:'Kneel, heels anchored, lower your body forward as slowly as you can, catch with your hands.',setup:'Kneel on a cushion with your heels hooked under a sofa or held by someone.',steps:['Keep hips straight, body in one line.','Lower forward as slowly as you can.','Catch yourself with your hands.','Push back up with your hands. Repeat.'],feel:'Hamstrings working hard while they lengthen.',mistakes:'Bending at the hips.',easier:'Only lower a short way.',harder:'Lower further before catching.'}),
X({id:'pike-lift',name:'Seated Pike Compression Lift',area:['hamstrings'],kind:'endrange',sides:false,perSide:'',poseFrom:'seated-fold',order:5,secs:30,cue:'Sit tall, legs straight, hands beside the knees; lift both heels a few cm and hold.',setup:'Sit with legs straight together, hands on the floor beside the knees.',steps:['Sit tall and lean slightly forward.','Lift both heels just off the floor using the front of your hips.','Hold the lift.','Lower gently.'],feel:'Front of the hips working while the hamstrings are stretched.',mistakes:'Leaning back.',easier:'Lift one leg at a time.',harder:'Move hands nearer the hips.'}),
X({id:'rfe-hip-flexor',name:'Rear-Foot-Elevated Hip Flexor',area:['quads','hips'],poseFrom:'couch',equip:['chair'],swap:'kneel-hip-flexor',order:3,cue:'Back knee down, back foot on a chair, tuck pelvis, squeeze the back glute.',setup:'Kneel with your back to a chair, back foot on the seat, front foot forward.',steps:['Tuck your tailbone under.','Squeeze the back-leg glute.','Lift your chest tall.','Hold at a firm stretch.'],feel:'Front of the back hip and thigh.',mistakes:'Arching the lower back.',easier:'Keep the back foot on the floor.',harder:'Raise your arms overhead.'}),
X({id:'standing-hf',name:'Split-Stance Hip Flexor',area:['quads','hips'],poseFrom:'walking-lunge',order:1,cue:'Long split stance, back heel up, tuck pelvis and push the back hip forward.',setup:'Stand in a long split stance, back heel lifted.',steps:['Bend the front knee a little.','Tuck the tailbone and squeeze the back glute.','Shift the hips forward.','Hold.'],feel:'Front of the back hip.',mistakes:'Leaning back or arching.',easier:'Shorter stance.',harder:'Reach the same-side arm up and over.'}),
X({id:'thomas-stretch',name:'Edge-of-Bed Hip Flexor',area:['quads','hips'],poseFrom:'knees-chest',order:6,cue:'Lie at the end of a bed, hug one knee, let the other leg hang and relax.',setup:'Sit at the very end of a bed or bench, roll back hugging both knees.',steps:['Keep one knee hugged to your chest.','Let the other leg hang down.','Relax the hanging leg completely.','Hold and breathe.'],feel:'Front of the hanging hip.',mistakes:'Letting the lower back arch.',easier:'Hug the knee less tightly.',harder:'Bend the hanging knee more (or add a light ankle weight).'}),
X({id:'split-squat-ecc',name:'Long-Stride Split Squat (slow lowering)',area:['quads','hips'],kind:'loaded',poseFrom:'walking-lunge',order:2,icon:'🏋️',cue:'Long stride, lower slowly until the back knee nearly touches, pause, drive up.',setup:'Long split stance, hold dumbbells if you have them.',steps:['Lower slowly for 3–4 s.','Pause with the back knee near the floor and hips tucked.','Feel the stretch at the front of the back hip.','Drive up and repeat.'],feel:'Front leg working, back hip stretching.',mistakes:'Arching the back.',easier:'Hold a support.',harder:'Heavier dumbbells.'}),
X({id:'reverse-nordic',name:'Partial Reverse Nordic',area:['quads'],kind:'loaded',sides:false,perSide:'',poseFrom:'kneel-lift',order:4,icon:'🏋️',cue:'Kneel tall, lean back slowly in one line from knees to head, then return.',setup:'Kneel on a cushion, knees hip-width, body upright.',steps:['Squeeze glutes so hips stay straight.','Lean back slowly as far as is comfortable.','Pause.','Come back up.'],feel:'Front of the thighs working while stretched.',mistakes:'Bending at the hips.',easier:'Lean back only a little.',harder:'Lean further.'}),
X({id:'straddle-reach',name:'Seated Straddle Side Reach',area:['hips','hamstrings'],poseFrom:'wide-fold',order:5,cue:'Legs wide, sit tall, reach over one leg with a long spine.',setup:'Sit with legs wide, toes up.',steps:['Sit tall on your sit bones.','Turn your chest toward one leg.','Hinge forward over that leg.','Hold, then do the other side.'],feel:'Inner thigh and back of the leg.',mistakes:'Rounding hard to reach the foot.',easier:'Sit on a cushion.',harder:'Widen the legs.'}),
X({id:'side-lunge',name:'Side Lunge Hold',area:['hips'],poseFrom:'cossack',order:2,cue:'Wide stance, sit into one hip with the other leg straight, hold.',setup:'Stand with feet very wide.',steps:['Bend one knee and sit back into that hip.','Keep the other leg straight, foot flat.','Keep the chest up.','Hold.'],feel:'Inner thigh of the straight leg.',mistakes:'Knee caving in.',easier:'Hold a chair.',harder:'Sit lower.'}),
X({id:'bench-pigeon',name:'Pigeon on a Bench',area:['hips','glutes'],poseFrom:'pigeon',equip:['box'],swap:'pigeon',order:2,cue:'Front shin across a bench or bed, back leg standing, fold forward.',setup:'Stand facing a bench or bed. Lay one shin across it, knee out to the side.',steps:['Keep the back leg straight.','Square your hips.','Hinge forward over the shin.','Hold.'],feel:'Outer hip and buttock.',mistakes:'Twisting the knee.',easier:'Use a higher surface.',harder:'Fold lower.'}),
X({id:'weighted-pigeon',name:'Weighted Pigeon Lean',area:['hips','glutes'],kind:'loaded',poseFrom:'pigeon',order:5,icon:'🏋️',cue:'Pigeon pose, hold a weight at the chest and lean forward slowly, pause, return.',setup:'Get into pigeon pose. Hold a dumbbell at your chest if you have one.',steps:['Lean forward slowly for 3–4 s.','Pause in the stretch.','Come back up using the hip.','Repeat.'],feel:'Outer hip working and stretching.',mistakes:'Twisting the front knee.',easier:'No weight.',harder:'Heavier weight.'}),
X({id:'copenhagen',name:'Short-Lever Copenhagen Hold',area:['hips'],kind:'endrange',poseFrom:'side-quad',equip:['box'],swap:'side-adduct',order:5,secs:30,cue:'Side plank with the top knee on a bench, lift the hips and hold.',setup:'Lie on your side, top knee on a bench, elbow under shoulder.',steps:['Press the top knee into the bench.','Lift your hips into a line.','Hold.','Lower gently.'],feel:'Inner thigh of the top leg working.',mistakes:'Hips sagging.',easier:'Lower bench.',harder:'Top foot on the bench (long lever).'}),
X({id:'side-adduct',name:'Side-lying Adductor Lift',area:['hips'],kind:'endrange',poseFrom:'side-quad',order:5,secs:30,cue:'On your side, top leg crossed in front; lift the bottom leg and hold.',setup:'Lie on your side, top foot planted in front of the bottom knee.',steps:['Keep the bottom leg straight.','Lift it a hand-width.','Hold.','Lower slowly.'],feel:'Inner thigh of the bottom leg working.',mistakes:'Rolling backward.',easier:'Lift lower.',harder:'Add an ankle weight.'}),
X({id:'hip-cars',name:'Hip CARs (slow circles)',area:['hips'],kind:'endrange',poseFrom:'leg-swing-side',equip:['wall'],order:1,secs:30,cue:'Standing on one leg at a wall, draw the biggest slow circle you can with the knee.',setup:'Stand side-on to a wall with one hand on it.',steps:['Lift one knee to hip height.','Open it out to the side.','Rotate the foot up behind you, then bring the knee back.','Go slowly, pelvis still. Reverse.'],feel:'Hip working through its full range.',mistakes:'Twisting the body.',easier:'Smaller circles.',harder:'Slower, with pauses.'}),
];
// pattern, diff, pnf
const T={
'calf-wall':['calf-straight',1,1],'step-calf':['calf-straight',2,1],'downdog':['calf-straight',1,0],'deficit-calf':['calf-straight',2,0],'floor-calf-ecc':['calf-straight',1,0],
'soleus':['calf-bent',1,1],'kneel-soleus':['calf-bent',1,1],'deep-squat':['calf-bent',2,0],'band-ankle':['calf-bent',2,0],'calf-ecc-bent':['calf-bent',2,0],'kot-weighted':['calf-bent',2,0],'soleus-iso':['calf-bent',1,0],'knee-wall':['calf-bent',1,0],'tib-raise':['calf-bent',1,0],
'standing-ham':['ham-hinge',1,1],'seated-fold':['ham-hinge',2,1],'wide-fold':['ham-hinge',2,0],'half-split':['ham-hinge',1,1],'half-split-bw':['ham-hinge',1,1],'heel-chair-ham':['ham-hinge',1,1],'jefferson':['ham-hinge',3,0],'pike-lower':['ham-hinge',2,0],'sl-rdl':['ham-hinge',2,0],'nordic-assist':['ham-hinge',3,0],'pike-lift':['ham-hinge',2,0],
'supine-ham':['ham-supine',1,1],'thigh-ham':['ham-supine',1,1],'legs-wall':['ham-supine',1,0],'alsr-hold':['ham-supine',1,0],
'kneel-hip-flexor':['hipflex',1,1],'couch':['hipflex',3,1],'lizard':['hipflex',2,0],'rfe-hip-flexor':['hipflex',2,1],'standing-hf':['hipflex',1,1],'thomas-stretch':['hipflex',1,0],'kneel-lift':['hipflex',2,0],'split-squat-ecc':['hipflex',2,0],
'quad-stand':['quad',1,1],'side-quad':['quad',1,1],'reverse-nordic':['quad',3,0],
'pigeon':['hip-er',2,1],'figure4':['hip-er',1,1],'bench-pigeon':['hip-er',2,1],'weighted-pigeon':['hip-er',2,0],'it-cross':['hip-er',1,0],
'90-90':['hip-rot',2,1],'9090-lift':['hip-rot',2,0],'hip-cars':['hip-rot',1,0],'happy-baby':['hip-rot',1,0],
'frog':['adductor',2,0],'butterfly':['adductor',1,1],'reclined-butterfly':['adductor',1,0],'straddle-reach':['adductor',2,1],'side-lunge':['adductor',1,0],'cossack':['adductor',2,0],'copenhagen':['adductor',2,0],'side-adduct':['adductor',1,0],'adductor-rock':['adductor',1,0]};
const PAT_AREA={'calf-straight':'calves','calf-bent':'calves','ham-hinge':'hamstrings','ham-supine':'hamstrings',hipflex:'hipflex',quad:'hipflex','hip-er':'hips','hip-rot':'hips',adductor:'hips'};
// Standing eligibility, reviewed from each move's setup, steps and cue (not from the name).
// 1 = the written instructions stay on the feet. A wall, rail or chair is allowed only as support.
// 0 = the written instructions sit, kneel, lie or use the floor. No standing variation was invented.
// The string is a classification note. Empty means the position is unambiguous. Notes are shown in the app.
const OR='Setup offers standing and another position. Standing only uses the written standing option.';
const SITINTO='“Sit into” means shifting the hips over a bent leg. Both feet stay planted; you do not sit down.';
const STAND={
'adductor-rock':[1,SITINTO],
'standing-ham':[1,''],
'wide-fold':[1,'Standing forward hinge. The hands may reach the floor; both feet stay planted.'],
'quad-stand':[1,''],
'calf-wall':[1,''],
'soleus':[1,''],
'step-calf':[1,''],
'it-cross':[1,''],
'side-bend':[1,''],
'cross-arm':[1,OR],
'triceps':[1,OR],
'doorway':[1,''],
'neck-side':[1,'Setup says sit or stand. Standing only uses standing. The “sit tall” cue is the other written option and is not used.'],
'deep-squat':[1,'Hips drop between the heels with the heels down. You stay on your feet, not sitting, kneeling or lying.'],
'wrist-flex':[1,OR],
'wrist-ext':[1,OR],
'leg-swing':[1,''],
'leg-swing-side':[1,''],
'ankle-circles':[1,''],
'walking-lunge':[1,'The back knee moves toward the floor, then you step through. The instructions do not rest the knee down.'],
'knee-wall':[1,'Setup allows a kneel or a standing split stance. Standing only uses the written split stance.'],
'cossack':[1,SITINTO],
'deficit-calf':[1,''],
'jefferson':[1,'Standing roll-down on a box or step. The feet stay under you.'],
'sl-rdl':[1,''],
'tib-raise':[1,''],
'toe-mob':[1,'Setup says sit on a chair or stand barefoot. Standing only uses the written standing option.'],
'soleus-iso':[1,''],
'floor-calf-ecc':[1,''],
'pike-lower':[1,'Standing roll-down. The hands may hang toward the floor; you do not sit or lie down.'],
'wall-chest':[1,''],
'band-ankle':[1,'Setup allows a half-kneel or a standing split stance. Standing only uses the written standing split stance.'],
'calf-ecc-bent':[1,''],
'heel-chair-ham':[1,'One heel rests on a chair. The other foot stays on the floor and the body stays standing.'],
'standing-hf':[1,''],
'split-squat-ecc':[1,'The back knee pauses near the floor without being set down. It stays a standing split squat.'],
'side-lunge':[1,SITINTO],
'hip-cars':[1,''],
'kneel-hip-flexor':[0,'Setup starts kneeling on one knee.'],
'couch':[0,'Setup starts kneeling, with the shin up a wall or sofa.'],
'pigeon':[0,'Starts on hands and knees and folds on the mat.'],
'figure4':[0,'Setup is lying on your back.'],
'90-90':[0,'Setup is sitting on the floor.'],
'frog':[0,'Starts on hands and knees.'],
'butterfly':[0,'Setup is sitting on the floor.'],
'lizard':[0,'The back knee is lowered to the floor.'],
'supine-ham':[0,'Setup is lying on your back.'],
'seated-fold':[0,'Setup is sitting on the floor.'],
'side-quad':[0,'Setup is lying on your side.'],
'downdog':[0,'Hands and feet are on the floor in an inverted V. That is floor work.'],
'toe-sit':[0,'Setup starts kneeling, then sitting back on the heels.'],
'shin':[0,'Setup starts kneeling.'],
'childs':[0,'Setup starts kneeling.'],
'cat-cow':[0,'Setup is hands and knees.'],
'supine-twist':[0,'Setup is lying on your back.'],
'thread-needle':[0,'Setup is hands and knees. “Standing hand” means the supporting hand, not a standing position.'],
'cobra':[0,'Setup is lying face down.'],
'knees-chest':[0,'Setup is lying on your back.'],
'puppy':[0,'Setup is hands and knees.'],
'worlds-greatest':[0,'Setup is a lunge with the back knee low or resting on the floor.'],
'happy-baby':[0,'Setup is lying on your back.'],
'ankle-circle':[0,'Setup is half-kneeling.'],
'legs-wall':[0,'Setup swings the legs up a wall and lies back.'],
'reclined-butterfly':[0,'Setup is lying on your back.'],
'side-child':[0,'Starts in child\'s pose, which is kneeling.'],
'banana':[0,'Setup is lying on your back.'],
'levator':[0,'Setup is sitting on a chair or the floor. No standing option is written.'],
'open-book':[0,'Setup is lying on your side.'],
'alsr-hold':[0,'Setup is lying on your back.'],
'kneel-lift':[0,'Setup is a deep half-kneeling stretch.'],
'9090-lift':[0,'Setup is sitting in 90/90.'],
'tspine-lift':[0,'Setup is hands and knees.'],
'breathing':[0,'Setup is lying face down.'],
'thigh-ham':[0,'Setup is lying on your back.'],
'kneel-soleus':[0,'Setup starts kneeling on one knee.'],
'kot-weighted':[0,'Setup is half-kneeling.'],
'half-split':[0,'Setup starts kneeling.'],
'half-split-bw':[0,'Setup starts kneeling.'],
'nordic-assist':[0,'Setup starts kneeling.'],
'pike-lift':[0,'Setup is sitting with the legs straight.'],
'rfe-hip-flexor':[0,'The back knee is down and the back foot is on a chair.'],
'thomas-stretch':[0,'Setup rolls back on a bed and lets one leg hang.'],
'reverse-nordic':[0,'Setup starts kneeling.'],
'straddle-reach':[0,'Setup is sitting with the legs wide.'],
'bench-pigeon':[0,'The front shin rests across a bench in pigeon. A straight back leg does not make this standing.'],
'weighted-pigeon':[0,'Setup is pigeon on the floor.'],
'copenhagen':[0,'Setup is lying on your side.'],
'side-adduct':[0,'Setup is lying on your side.']
};
function applyStand(lib){
  for(const s of lib){const t=STAND[s.id];
    if(!t){s.stand=false;s.standUnreviewed=true;s.standAssume='Unreviewed instructions; excluded from standing only.';continue}
    s.stand=!!t[0];s.standAssume=t[1]||'';s.standUnreviewed=false}
  return lib;
}
function install(lib){
  const by=Object.fromEntries(lib.map(s=>[s.id,s]));
  for(const n of NEW){if(by[n.id])continue;const b=by[n.poseFrom];const s={...n,pose:b?b.pose:[],demoNote:b?'Demo shows the closest base position ('+b.name+').':''};lib.push(s);by[s.id]=s}
  for(const s of lib){const t=T[s.id];if(t){s.pattern=t[0];s.diff=t[1];s.pnf=!!t[2];s.parea=PAT_AREA[t[0]]}}
  applyStand(lib);
  return lib;
}
const api={NEW,TAGS:T,PAT_AREA,STAND,applyStand,install};
if(typeof module!=='undefined')module.exports=api;else{root.LIB2=api;if(root.STRETCHES)install(root.STRETCHES)}
})(this);
