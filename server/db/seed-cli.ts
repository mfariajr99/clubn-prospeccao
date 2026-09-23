import { defaultDbFile, openDatabase, runMigrations } from "./connection.js";
import { seed } from "./seed.js";

const db = openDatabase(defaultDbFile());
runMigrations(db);
seed(db, process.argv.includes("--reset"));
db.close();
