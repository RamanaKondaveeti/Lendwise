const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgres://lendwise:change-me@localhost:5432/lendwise' });
app.use(cors()); app.use(express.json());
const q = (text, params) => pool.query(text, params);
async function init() {
  const schema = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
  await q(schema);
  const { rows } = await q('SELECT count(*)::int AS n FROM people');
  if (!rows[0].n) {
    const people = [['Alex Morgan','AM','#d7efe2'],['Maya Chen','MC','#f4d8bf'],['Leo Park','LP','#d6e1f4'],['Nina Patel','NP','#f1d6e3'],['Sam Rivera','SR','#e8e2bd']];
    for (const p of people) await q('INSERT INTO people(name, initials, color) VALUES($1,$2,$3)', p);
    const g = await q("INSERT INTO groups(name, icon, color) VALUES('Weekend in the woods','mountain','#dcebdd'),('Flat 4B','house','#eee0cf'),('The usuals','users','#e9ddf2') RETURNING id");
    const ids = (await q('SELECT id FROM people ORDER BY id')).rows.map(x=>x.id);
    const groupIds = g.rows.map(x=>x.id);
    await q("INSERT INTO expenses(group_id,title,amount,paid_by,category,created_at) VALUES($1,'Cabin groceries',186.40,$2,'Shopping',NOW()-INTERVAL '2 days'),($1,'Gas for the drive',72.00,$3,'Transport',NOW()-INTERVAL '3 days')", [groupIds[0],ids[1],ids[2]]);
    await q("INSERT INTO expenses(group_id,title,amount,paid_by,category,created_at) VALUES($1,'Internet - November',64.99,$2,'Utilities',NOW()-INTERVAL '1 day')", [groupIds[1],ids[3]]);
    await q("INSERT INTO expenses(group_id,title,amount,paid_by,category,created_at) VALUES($1,'Dinner at Momo House',124.50,$2,'Food & drink',NOW()-INTERVAL '5 hours')", [groupIds[2],ids[1]]);
    const expenses=(await q('SELECT id,group_id,amount FROM expenses')).rows;
    for(const e of expenses){ const participants=e.group_id===groupIds[0]?ids.slice(0,4):e.group_id===groupIds[1]?ids.slice(0,3):ids.slice(0,4); const each=Number(e.amount)/participants.length; for(const pid of participants) await q('INSERT INTO splits(expense_id,person_id,amount) VALUES($1,$2,$3)',[e.id,pid,each]); }
    await q('INSERT INTO settlements(payer_id,payee_id,amount,note) VALUES($1,$2,38.50,\'Coffee catch-up\')',[ids[0],ids[1]]);
  }
}
app.get('/api/health', async (_req,res)=>{try{await q('SELECT 1');res.json({ok:true})}catch(e){res.status(503).json({ok:false})}});
app.get('/api/summary', async (_req,res)=>{try{
 const people=(await q('SELECT id,name,initials,color FROM people ORDER BY id')).rows;
 const groups=(await q(`SELECT g.id,g.name,g.icon,g.color,COUNT(DISTINCT e.id)::int AS expenses,COALESCE(SUM(e.amount),0)::float AS total FROM groups g LEFT JOIN expenses e ON e.group_id=g.id GROUP BY g.id ORDER BY g.id`)).rows;
 const activity=(await q(`SELECT e.id,e.title,e.amount::float,e.category,e.created_at,p.name AS payer,p.initials,p.color,g.name AS group_name FROM expenses e JOIN people p ON p.id=e.paid_by JOIN groups g ON g.id=e.group_id ORDER BY e.created_at DESC LIMIT 12`)).rows;
 const net=(await q(`SELECT p.id,p.name,p.initials,p.color,COALESCE((SELECT SUM(s.amount) FROM splits s JOIN expenses e ON e.id=s.expense_id WHERE s.person_id=p.id),0)-COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.paid_by=p.id),0)+COALESCE((SELECT SUM(amount) FROM settlements WHERE payee_id=p.id),0)-COALESCE((SELECT SUM(amount) FROM settlements WHERE payer_id=p.id),0) AS balance FROM people p ORDER BY p.id`)).rows;
 res.json({people,groups,activity,balances:net.map(x=>({...x,balance:Number(x.balance)})),currentUserId:people[0]?.id});
 }catch(e){console.error(e);res.status(500).json({error:'Could not load your expense data.'})}});
app.post('/api/expenses',async(req,res)=>{const{groupId,title,amount,paidBy,category='Other',participants}=req.body;if(!groupId||!title||!Number.isFinite(Number(amount))||Number(amount)<=0||!Array.isArray(participants)||!participants.length)return res.status(400).json({error:'Add a title, positive amount, group, and participants.'});const c=await pool.connect();try{await c.query('BEGIN');const e=await c.query('INSERT INTO expenses(group_id,title,amount,paid_by,category) VALUES($1,$2,$3,$4,$5) RETURNING id',[groupId,title,amount,paidBy,category]);const each=Number(amount)/participants.length;for(const id of participants)await c.query('INSERT INTO splits(expense_id,person_id,amount) VALUES($1,$2,$3)',[e.rows[0].id,id,each]);await c.query('COMMIT');res.status(201).json({ok:true,id:e.rows[0].id})}catch(err){await c.query('ROLLBACK');console.error(err);res.status(500).json({error:'Could not save this expense.'})}finally{c.release()}});
app.post('/api/groups',async(req,res)=>{const{name,icon='users',color='#e9ddf2'}=req.body;if(!name?.trim())return res.status(400).json({error:'Group name is required.'});const r=await q('INSERT INTO groups(name,icon,color) VALUES($1,$2,$3) RETURNING *',[name.trim(),icon,color]);res.status(201).json(r.rows[0])});
app.post('/api/settlements',async(req,res)=>{const{payerId,payeeId,amount,note='Settlement'}=req.body;if(!payerId||!payeeId||Number(amount)<=0)return res.status(400).json({error:'Choose two people and a positive amount.'});await q('INSERT INTO settlements(payer_id,payee_id,amount,note) VALUES($1,$2,$3,$4)',[payerId,payeeId,amount,note]);res.status(201).json({ok:true})});
const port=process.env.PORT||5000;init().then(()=>app.listen(port,'0.0.0.0',()=>console.log(`Lendwise API listening on ${port}`))).catch(e=>{console.error('Database startup failed',e);process.exit(1)});


