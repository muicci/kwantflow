import { invoke } from '@tauri-apps/api/core';

export type NativeDatabaseScope = 'control' | 'workspace';

export type NativeExecuteResult = {
	rowsAffected: number;
	lastInsertId: number;
};

export class NativeDatabase {
	constructor(private readonly scope: NativeDatabaseScope) {}

	async select<T>(sql: string, params: unknown[] = []): Promise<T> {
		return await invoke<T>(`query_${this.scope}_database`, { sql, params });
	}

	async execute(sql: string, params: unknown[] = []): Promise<NativeExecuteResult> {
		return await invoke<NativeExecuteResult>(`execute_${this.scope}_database`, { sql, params });
	}

	async close(): Promise<void> {
		// Connections are owned by Rust and follow the application/workspace lifecycle.
	}
}
