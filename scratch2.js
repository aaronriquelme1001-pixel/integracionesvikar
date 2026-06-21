require('dotenv').config();
const {Pool}=require('pg');
const p=new Pool({connectionString:process.env.DATALAKE_URL,ssl:{rejectUnauthorized:false}});
p.query("SELECT plate, COUNT(*) FROM global_telemetry_traffic WHERE plate ILIKE '%pe%6549%' GROUP BY plate").then(res=>{
  console.log("PLATES:", res.rows);
  p.end();
}).catch(console.error);
