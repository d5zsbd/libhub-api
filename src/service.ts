import type { Client, Transaction } from "@libsql/client";

export type QueryExecutor = Client | Transaction;

