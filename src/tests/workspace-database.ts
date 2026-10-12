type SqliteExecutor = {
	exec(sql: string): unknown;
};

export function seedWorkspaceIdentities(
	database: SqliteExecutor,
	workspaceIds: readonly string[] = ['local-workspace']
): void {
	for (const workspaceId of workspaceIds) {
		const escapedId = workspaceId.replaceAll("'", "''");
		database.exec(`
			INSERT INTO workspace_identity (id, bootstrap_completed_at)
			VALUES ('${escapedId}', CURRENT_TIMESTAMP);
			INSERT INTO workspace_profile (workspace_id, display_name)
			VALUES ('${escapedId}', '${escapedId}');
		`);
	}
}
