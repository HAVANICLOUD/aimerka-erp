(function(){
 const iso=d=>d.toISOString().slice(0,10),plus=(s,n)=>iso(new Date(Date.parse(s+'T12:00:00Z')+n*86400000));
 function weeks(year){const jan4=year+'-01-04',start=plus(jan4,-((new Date(jan4+'T12:00:00Z').getUTCDay()+6)%7)),nextJan4=(year+1)+'-01-04',end=plus(nextJan4,-((new Date(nextJan4+'T12:00:00Z').getUTCDay()+6)%7)),out=[];for(let d=start,n=1;d<end;d=plus(d,7),n++)out.push({number:n,from:d,to:plus(d,6)});return out;}
 function weekYear(day){return Number(plus(day,3-((new Date(day+'T12:00:00Z').getUTCDay()+6)%7)).slice(0,4));}
 window.AnalysisPeriods={weeks,weekYear};
})();
