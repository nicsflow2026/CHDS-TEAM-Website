"use strict";
window.CHDS=(()=>{
  
const CONFIG={
  API:"",            
  CUR:"₱",           
  TG:"chproofs",     
  WA:"",             
  EMAIL:"hello@chdigitalservices.example",
  POLL:15000     
};

const TEAM=[
  {n:"Charles Amper",r:"Founder",g:"founder",tg:"chproofs",fb:"",img:""},
  ...Array.from({length:4},(_,i)=>({n:"Admin "+(i+1),r:"Admin",g:"admin",tg:"",fb:"",img:""})),
  ...Array.from({length:12},(_,i)=>({n:"Member "+(i+1),r:"Recovery Specialist",g:"member",tg:"",fb:"",img:""}))
];

return{CONFIG,TEAM};
})();
