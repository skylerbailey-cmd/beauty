'use strict';
// The audit lists a row per day and the totals lived only in stat boxes above
// the table. On a fortnight's audit you reach the bottom with the figures you
// are adding up long since scrolled away — so the table now foots itself.
//
// The row it prints also says the thing the boxes cannot: a net difference of
// four cents across days that are out by thousands in both directions means
// the overs and unders cancelled, not that the books agree.
const fs = require('fs');
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (_) {
  console.log('\n  skipped: jsdom is not installed (npm i -D jsdom to run this one)\n');
  process.exit(0);
}
const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'pos.html'), 'utf8');
const dom=new JSDOM(html,{url:'https://glowsf.sky-sale.com/pos.html',runScripts:'dangerously',
 beforeParse(w){w.fetch=()=>Promise.reject(new Error('offline'));w.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});
  w.scrollTo=()=>{};w.alert=()=>{};
  Object.defineProperty(w,'localStorage',{value:{store:{},getItem(k){return this.store[k]??null},setItem(k,v){this.store[k]=v},removeItem(k){delete this.store[k]}}});}});
const w=dom.window; let pass=0,fail=0;
const check=(l,ok,d)=>{console.log(`${ok?'  ok  ':'  FAIL'} ${l}`); if(!ok&&d)console.log('        '+d); ok?pass++:fail++;};
const foot=()=>w.document.getElementById('batchFoot');
setTimeout(()=>{
  // Two days that disagree in opposite directions, and one that matches.
  const rows=[
    { date:'2026-09-07', merchant_total:37728.19, pos_total:43728.23, difference:-6000.04, matched:false, pos_sale_count:4, pos_return_count:0, by_processor:{maverick:0,payarc:37728.19} },
    { date:'2026-09-08', merchant_total:1298.26, pos_total:-4701.74, difference:6000.00, matched:false, pos_sale_count:2, pos_return_count:1, by_processor:{maverick:0,payarc:1298.26} },
    { date:'2026-09-03', merchant_total:540.94, pos_total:540.94, difference:0, matched:true, pos_sale_count:2, pos_return_count:0, by_processor:{maverick:540.94,payarc:0} },
  ];
  const t={ merchant:39567.39, pos:39567.43, difference:-0.04 };
  w.eval(`renderBatchTotals(${JSON.stringify(rows)}, ${JSON.stringify(t)}, 2)`);
  const txt=foot().textContent.replace(/\s+/g,' ');
  check('a totals row is rendered', foot().querySelectorAll('tr').length===1);
  check('it counts the days', /All 3 days/.test(txt), txt);
  check('merchant total', txt.includes('39,567.39'));
  check('POS total', txt.includes('39,567.43'));
  check('the processor split adds up', txt.includes('39,026.45') && txt.includes('540.94'), txt);
  check('sale and return counts are summed', /8 sales, 1 return/.test(txt), txt);
  check('it says how many need investigating', /2 of 3 to investigate/.test(txt), txt);
  check('and warns that overs and unders cancel', /overs and unders cancel/.test(txt), txt);

  console.log('\n-- every day matching --');
  const good=[{ date:'2026-09-03', merchant_total:540.94, pos_total:540.94, difference:0, matched:true, pos_sale_count:2, pos_return_count:0 }];
  w.eval(`renderBatchTotals(${JSON.stringify(good)}, ${JSON.stringify({merchant:540.94,pos:540.94,difference:0})}, 0)`);
  const t2=foot().textContent.replace(/\s+/g,' ');
  check('says every day matches', /every day matches/.test(t2), t2);
  check('singular day', /All 1 day\b/.test(t2), t2);
  check('no processor split when the data has none', !/Maverick/.test(t2), t2);
  check('no cancellation warning when nothing is off', !/cancel/.test(t2));

  console.log('\n-- nothing in range --');
  w.eval('renderBatchTotals([], {}, 0)');
  check('the foot is empty', foot().innerHTML==='' , foot().innerHTML);

  console.log('\n-- server sent no totals object --');
  w.eval(`renderBatchTotals(${JSON.stringify(rows)}, {}, 2)`);
  const t3=foot().textContent.replace(/\s+/g,' ');
  check('it adds the rows up itself', t3.includes('39,567.39') && t3.includes('39,567.43'), t3);
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail?1:0);
},600);
