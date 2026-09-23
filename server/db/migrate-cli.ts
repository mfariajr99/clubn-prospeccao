import { defaultDbFile, ensureDefaultUser, openDatabase, runMigrations } from "./connection.js";

const file = defaultDbFile();
const db = openDatabase(file);
const applied = runMigrations(db);
ensureDefaultUser(db);
console.log(applied.length ? `Migrations aplicadas: ${applied.join(", ")} (${file})` : `Banco já atualizado (${file}).`);
db.close();
