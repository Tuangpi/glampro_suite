import { Client } from "pg";

const url = "postgresql://postgres:postgres@localhost:5432/glampro_tk0020_concurrency";
const a = new Client({ connectionString: url });
const b = new Client({ connectionString: url });
await a.connect();
await b.connect();

const t = await a.query(
  "select table_name, column_name from information_schema.columns where table_name in ('appointments','appointment_lines','appointment_series') and column_name ilike '%tenant%' order by table_name",
);
console.log("tenant columns:", JSON.stringify(t.rows));

await a.query(
  "insert into tenants (id, name, slug, \"createdAt\", \"updatedAt\") values ('tk0020-probe-tenant', 'Probe', 'tk0020-probe', now(), now()) on conflict (id) do nothing",
);
const tid = "tk0020-probe-tenant";

await a.query("BEGIN");
await a.query("select id from tenants where id = $1 for no key update", [tid]);

let bDone = false;
const pB = b
  .query("select id from tenants where id = $1 for no key update", [tid])
  .then(() => {
    bDone = true;
  });

await new Promise((r) => setTimeout(r, 700));
console.log("B blocked while A holds lock:", bDone === false);

await a.query("COMMIT");
await pB;
console.log("B acquired after A commit:", bDone === true);

await b.query("ROLLBACK").catch(() => {});
await a.end();
await b.end();
