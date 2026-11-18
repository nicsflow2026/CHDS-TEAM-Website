"use strict";
window.CHDS=(()=>{
/* ============ CONFIGURE HERE ============ */
const CONFIG={
  API:"",            // leave EMPTY on Vercel (same domain). Only fill if your API runs on another domain, e.g. "https://api.example.com" (no trailing slash)
  CUR:"$",           // currency symbol shown on revenue
  TG:"chproofs",     // Telegram username (no @)
  WA:"",             // WhatsApp number with country code, digits only (optional)
  EMAIL:"hello@chdigitalservices.example",
  POLL:15000         // live refresh interval (ms)
};
// g: founder | admin | member.  img: photo URL (optional). tg: Telegram username. fb: full Facebook URL.
const TEAM=[
  {n:"Charles Amper",r:"Founder",g:"founder",tg:"chproofs",fb:"",img:""},
  ...Array.from({length:4},(_,i)=>({n:"Admin "+(i+1),r:"Admin",g:"admin",tg:"",fb:"",img:""})),
  ...Array.from({length:12},(_,i)=>({n:"Member "+(i+1),r:"Recovery Specialist",g:"member",tg:"",fb:"",img:""}))
];
/* ======================================== */
return{CONFIG,TEAM};
})();
