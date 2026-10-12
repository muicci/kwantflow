import { z } from 'zod';
import runtimeManifest from '../../../src-tauri/local-ai-runtime-manifest.json';

export const LocalAiRuntimeCapabilitySchema = z.object({
	supportsConstrainedToolCalls: z.boolean(),
	supportsNativeToolCalls: z.boolean(),
	supportsReasoningSeparation: z.boolean(),
	supportsVisionInputs: z.boolean(),
	supportsPersistentConversation: z.boolean(),
	supportsPersistentConversationWithVision: z.boolean()
});

export type LocalAiRuntimeCapability = z.infer<typeof LocalAiRuntimeCapabilitySchema>;

export const LocalAiRuntimeManifestSchema = z.object({
	version: z.literal(2),
	clientRuntimeId: z.string().trim().min(1),
	litertLm: z.object({
		runtimeVersion: z.string().trim().min(1),
		modelRepoId: z.string().trim().min(1),
		modelRevision: z.string().trim().min(1),
		modelArtifactId: z.string().trim().min(1),
		modelFileName: z.string().trim().min(1),
		remoteArtifactFilename: z.string().trim().min(1),
		remoteMmprojFilename: z.string().trim().min(1).nullable(),
		modelExpectedSizeBytes: z.number().int().positive(),
		modelSha256: z.string().trim().length(64),
		archivedMirror: z
			.object({
				modelRevision: z.string().trim().min(1),
				modelSha256: z.string().regex(/^[a-f0-9]{64}$/),
				modelExpectedSizeBytes: z.number().int().positive(),
				parts: z
					.array(
						z.object({
							url: z.url().startsWith('https://'),
							sizeBytes: z
								.number()
								.int()
								.positive()
								.max(2 ** 31 - 1),
							sha256: z.string().regex(/^[a-f0-9]{64}$/)
						})
					)
					.length(2)
			})
			.nullable()
			.optional(),
		capabilities: LocalAiRuntimeCapabilitySchema
	}),
	contextSizeTokens: z.number().int().positive()
});

export type LocalAiRuntimeManifest = z.infer<typeof LocalAiRuntimeManifestSchema>;

export const localAiRuntimeManifest = LocalAiRuntimeManifestSchema.parse(runtimeManifest);

export function getLocalAiRuntimeCapabilities(): LocalAiRuntimeCapability {
	return localAiRuntimeManifest.litertLm.capabilities;
}

export function getEffectiveLocalAiRuntimeCapabilities(): LocalAiRuntimeCapability {
	return getLocalAiRuntimeCapabilities();
}

export function getLocalAiRuntimeClientId(): string {
	return localAiRuntimeManifest.clientRuntimeId;
}

export function getLocalAiRemoteArtifactFilename(): string {
	return localAiRuntimeManifest.litertLm.remoteArtifactFilename;
}
