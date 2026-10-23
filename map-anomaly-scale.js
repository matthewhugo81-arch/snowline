// Approved 1 C temperature-anomaly palette. The first/last colours are
// under/over-range caps; the twenty interior colours cover [-10, 10).
export const ANOMALY_STYLE='20261023-revised-1c';
export const ANOMALY_SCALE={
 anomalyBands:1,
 stops:[-1000,...Array.from({length:21},(_,i)=>i-10)],
 colors:['#174879','#144e82','#0d5a93','#186da6','#3588bb','#52a0c8','#71b4ce','#97ccdb','#c6e8f0','#d6ebf4','#edf6fb','#fff3f0','#fce4de','#fbdad2','#fbd2ca','#fbcdc5','#fcaa92','#f88466','#f15a40','#d83625','#ae1a15','#990b0d'],
 legendNote:'1°C colour bands · −10 to +10°C; end colours extend beyond this range. Pale blue below zero; pale rose above zero.'
};
export function anomalyLegend(field){
 if(!field?.anomalyBands)return null;
 const colors=field.colors.slice(1,-1),min=field.stops[1],max=field.stops.at(-1);
 const ticks=Array.from({length:11},(_,i)=>min+i*(max-min)/10);
 return {colors,min,max,ticks,endColors:[field.colors[0],field.colors.at(-1)],
  gradient:'linear-gradient(to right,'+colors.flatMap((c,i)=>[c+' '+100*i/colors.length+'%',c+' '+100*(i+1)/colors.length+'%']).join(',')+')'};
}
