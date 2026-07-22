export async function onRequestGet(context) {
  const row = await context.env.DB.prepare(
    "SELECT expenses, members, rate, updated_at FROM shared_wallet WHERE id = 1"
  ).first();
  return Response.json(row ? {
    expenses: JSON.parse(row.expenses || '[]'),
    members: JSON.parse(row.members || '[]'),
    rate: Number(row.rate || 43),
    updated_at: row.updated_at
  } : {expenses: [], members: [], rate: 43, updated_at: null}, {
    headers: {'Cache-Control': 'no-store'}
  });
}

export async function onRequestPut(context) {
  let body;
  try { body = await context.request.json(); }
  catch { return Response.json({error:'Invalid JSON'}, {status:400}); }
  const expenses = Array.isArray(body.expenses) ? body.expenses.slice(0, 10000) : [];
  const members = Array.isArray(body.members) ? body.members.slice(0, 100) : [];
  const rate = Number(body.rate) > 0 ? Number(body.rate) : 43;
  const updated_at = new Date().toISOString();
  await context.env.DB.prepare(`
    INSERT INTO shared_wallet (id, expenses, members, rate, updated_at)
    VALUES (1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      expenses=excluded.expenses,
      members=excluded.members,
      rate=excluded.rate,
      updated_at=excluded.updated_at
  `).bind(JSON.stringify(expenses), JSON.stringify(members), rate, updated_at).run();
  return Response.json({ok:true, updated_at});
}
