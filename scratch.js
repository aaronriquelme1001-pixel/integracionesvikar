require('dotenv').config();
const {Pool}=require('pg');
const p=new Pool({connectionString:process.env.DATALAKE_URL,ssl:{rejectUnauthorized:false}});
p.query("SELECT client_id, COUNT(client_id) as c FROM billing_snapshots GROUP BY client_id").then(res=>{
  console.log("SNAPSHOTS:", res.rows);
  return p.query("SELECT client_source, COUNT(client_source) as c FROM global_telemetry_traffic GROUP BY client_source");
}).then(res=>{
  console.log("TELEMETRY:", res.rows);
  p.end();
}).catch(console.error);
