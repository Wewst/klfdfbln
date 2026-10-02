import pg from 'pg';import {readFile} from 'node:fs/promises';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==='true'?{rejectUnauthorized:true}:undefined});
try{await pool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");await pool.query(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));console.log('TONIX schema migrated')}finally{await pool.end()}
