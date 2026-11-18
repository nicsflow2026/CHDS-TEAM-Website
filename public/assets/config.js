"use strict";
/* Public, non-secret site settings only. Team members are no longer listed here: they come from
   Team Management in the admin dashboard (database) through /api/public/team. */
window.CHDS=(()=>{
const CONFIG={
  API:"",            // leave EMPTY on Vercel (same domain). The AI Support identity cookie only works on the same domain.
  CUR:"₱",           // currency symbol shown on revenue (Philippine peso)
  TG:"chproofs",     // public Telegram username (no @)
  WA:"",             // WhatsApp number with country code, digits only (optional)
  EMAIL:"hello@chdigitalservices.example",
  POLL:15000         // live results refresh interval (ms)
};
return{CONFIG};
})();
